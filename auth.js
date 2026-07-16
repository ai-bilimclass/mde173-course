/* auth.js — Supabase login gate, roles, cloud progress, teacher content overrides.
 * Runs BEFORE app.js. When configured, the course only boots after login.
 * When not configured (placeholder keys), boots immediately in open preview mode. */
(function () {
  "use strict";

  var configured =
    typeof window.SUPABASE_URL === "string" &&
    typeof window.SUPABASE_ANON_KEY === "string" &&
    window.SUPABASE_URL.indexOf("http") === 0 &&
    window.SUPABASE_ANON_KEY.length > 40;

  window.CourseBackend = {
    enabled: configured,
    user: null,
    profile: null,
    role: "learner",
    progress: null,
    overrides: {},
    saveProgress: function () {},
    saveOverride: null,
    deleteOverride: null,
    signOut: null
  };

  function boot() {
    if (window.__COURSE_BOOT__) window.__COURSE_BOOT__();
  }

  if (!configured) {
    // Open preview mode — no accounts, localStorage progress.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
    return;
  }

  var sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  var CB = window.CourseBackend;

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------------- Auth screen ----------------
  function authScreenHtml(mode) {
    var isLogin = mode === "login";
    return (
      '<div class="auth-wrap"><div class="auth-card">' +
      '<div class="auth-brand">MDE 173 &middot; ICT</div>' +
      "<h1>" + (isLogin ? "Welcome back" : "Create your learner account") + "</h1>" +
      '<p class="auth-sub">' +
      (isLogin
        ? "Sign in to continue the course. Your progress is saved to your account."
        : "Register free to access all course materials, track your progress and earn a certificate.") +
      "</p>" +
      '<form id="authForm">' +
      (isLogin ? "" : '<label>Full name</label><input type="text" id="authName" autocomplete="name" required placeholder="e.g. Aisha Nurlanovna"/>') +
      '<label>Email</label><input type="email" id="authEmail" autocomplete="email" required placeholder="you@example.com"/>' +
      '<label>Password</label><input type="password" id="authPass" autocomplete="' + (isLogin ? "current-password" : "new-password") + '" required minlength="6" placeholder="At least 6 characters"/>' +
      '<button type="submit" class="btn btn-solid auth-submit" id="authSubmit">' + (isLogin ? "Sign in" : "Register &amp; start learning") + "</button>" +
      "</form>" +
      '<div class="auth-msg" id="authMsg"></div>' +
      '<div class="auth-switch">' +
      (isLogin
        ? 'New here? <a href="javascript:void(0)" id="authSwitch">Create a free account</a>'
        : 'Already registered? <a href="javascript:void(0)" id="authSwitch">Sign in</a>') +
      "</div>" +
      "</div></div>"
    );
  }

  function showAuthScreen(mode) {
    var app = document.getElementById("app");
    app.className = "";
    app.innerHTML = authScreenHtml(mode);
    document.getElementById("authSwitch").addEventListener("click", function () {
      showAuthScreen(mode === "login" ? "register" : "login");
    });
    document.getElementById("authForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = document.getElementById("authMsg");
      var btn = document.getElementById("authSubmit");
      var email = document.getElementById("authEmail").value.trim();
      var pass = document.getElementById("authPass").value;
      msg.className = "auth-msg";
      msg.textContent = "";
      btn.disabled = true;
      btn.textContent = "Please wait…";

      var p;
      if (mode === "login") {
        p = sb.auth.signInWithPassword({ email: email, password: pass });
      } else {
        var name = document.getElementById("authName").value.trim();
        p = sb.auth.signUp({
          email: email,
          password: pass,
          options: { data: { full_name: name } }
        });
      }
      p.then(function (res) {
        if (res.error) throw res.error;
        if (mode === "register" && !res.data.session) {
          msg.className = "auth-msg ok";
          msg.innerHTML = "Almost done — <b>check your email</b> and click the confirmation link, then come back and sign in.";
          btn.disabled = false;
          btn.textContent = "Register & start learning";
          return;
        }
        return startSession(res.data.session);
      }).catch(function (err) {
        msg.className = "auth-msg err";
        msg.textContent = err.message || String(err);
        btn.disabled = false;
        btn.textContent = mode === "login" ? "Sign in" : "Register & start learning";
      });
    });
  }

  function showLoadingScreen(text) {
    var app = document.getElementById("app");
    app.className = "";
    app.innerHTML = '<div id="loading-screen"><div class="spinner"></div><p>' + esc(text) + "</p></div>";
  }

  // ---------------- Session start: fetch profile, progress, overrides ----------------
  function startSession(session) {
    if (!session || !session.user) { showAuthScreen("login"); return; }
    CB.user = session.user;
    showLoadingScreen("Loading your course…");

    return Promise.all([
      sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle(),
      sb.from("progress").select("data").eq("user_id", session.user.id).maybeSingle(),
      sb.from("content_overrides").select("*")
    ]).then(function (results) {
      var prof = results[0].data;
      var prog = results[1].data;
      var ovErr = results[2].error;
      var ovs = results[2].data || [];

      CB.profile = prof || null;
      CB.role = prof && prof.role === "teacher" ? "teacher" : "learner";
      CB.progress = (prog && prog.data) || null;
      if (ovErr) console.warn("Could not load content overrides:", ovErr.message);
      CB.overrides = {};
      ovs.forEach(function (o) { CB.overrides[o.activity_id] = o; });

      // Pre-fill certificate name from profile
      if (CB.progress && !CB.progress.name && prof && prof.full_name) CB.progress.name = prof.full_name;
      if (!CB.progress) CB.progress = { viewed: {}, quiz: {}, name: (prof && prof.full_name) || "", certId: "" };

      boot();
    });
  }

  // ---------------- Cloud progress (debounced upsert) ----------------
  var saveTimer = null;
  var pendingProgress = null;
  function flushProgress() {
    if (!pendingProgress || !CB.user) return Promise.resolve();
    var payload = { user_id: CB.user.id, data: pendingProgress, updated_at: new Date().toISOString() };
    pendingProgress = null;
    return sb.from("progress").upsert(payload).then(function (res) {
      if (res.error) console.warn("Progress save failed:", res.error.message);
    });
  }
  CB.saveProgress = function (progressObj) {
    pendingProgress = JSON.parse(JSON.stringify(progressObj));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushProgress, 700);
  };
  window.addEventListener("beforeunload", function () {
    // best-effort final flush
    if (pendingProgress && CB.user) {
      try {
        navigator.sendBeacon(
          window.SUPABASE_URL + "/rest/v1/progress?on_conflict=user_id",
          new Blob([JSON.stringify({ user_id: CB.user.id, data: pendingProgress })], { type: "application/json" })
        );
      } catch (e) {}
      flushProgress();
    }
  });

  // ---------------- Teacher content overrides ----------------
  CB.saveOverride = function (activityId, fields) {
    var row = {
      activity_id: activityId,
      title: fields.title != null ? fields.title : null,
      intro: fields.intro != null ? fields.intro : null,
      content: fields.content != null ? fields.content : null,
      updated_by: CB.user ? CB.user.id : null,
      updated_at: new Date().toISOString()
    };
    return sb.from("content_overrides").upsert(row).then(function (res) {
      if (res.error) throw res.error;
      CB.overrides[activityId] = row;
      return row;
    });
  };
  CB.deleteOverride = function (activityId) {
    return sb.from("content_overrides").delete().eq("activity_id", activityId).then(function (res) {
      if (res.error) throw res.error;
      delete CB.overrides[activityId];
    });
  };

  CB.signOut = function () {
    flushProgress().then(function () {
      sb.auth.signOut().then(function () { location.reload(); });
    });
  };

  // ---------------- Entry point ----------------
  function init() {
    showLoadingScreen("Checking session…");
    sb.auth.getSession().then(function (res) {
      var session = res.data ? res.data.session : null;
      if (session) startSession(session);
      else showAuthScreen("login");
    }).catch(function () {
      showAuthScreen("login");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
