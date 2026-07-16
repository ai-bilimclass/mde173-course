(function () {
  "use strict";

  var PASS_THRESHOLD = 0.6; // 60% to pass a quiz
  var STORAGE_KEY = "mde173_progress_v1";

  var COURSE = null;
  var FLAT = [];           // flattened ordered list of {id, section, activity}
  var BY_ID = {};          // activity id -> {activity, section, index}
  var progress = loadProgress();
  var openSections = {};   // sectionId -> bool (sidebar expand state)
  var quizState = {};      // in-memory answer state while taking a quiz: {questionId: value}
  var quizStarted = {};    // activityId -> bool (quiz intro passed)

  function backendOn() {
    return !!(window.CourseBackend && window.CourseBackend.enabled);
  }
  function isTeacher() {
    return backendOn() && window.CourseBackend.role === "teacher";
  }
  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { viewed: {}, quiz: {}, name: "", certId: "" };
  }
  function saveProgress() {
    if (backendOn()) {
      window.CourseBackend.saveProgress(progress);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeHtml(h) {
    if (!h) return "";
    return h.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/ on\w+="[^"]*"/gi, "");
  }
  function formatBytes(n) {
    if (!n) return "";
    var u = ["B", "KB", "MB", "GB"], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i === 0 ? 0 : 1) + " " + u[i];
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function stripTags(h) {
    var d = document.createElement("div");
    d.innerHTML = h || "";
    return d.textContent || "";
  }

  var TYPE_META = {
    url:      { label: "Link",        icon: "↗" },
    resource: { label: "Reading",     icon: "▤" },
    folder:   { label: "Folder",      icon: "▦" },
    page:     { label: "Page",        icon: "▤" },
    book:     { label: "Reading",     icon: "§" },
    lesson:   { label: "Lesson",      icon: "▶" },
    forum:    { label: "Announcement",icon: "◆" },
    data:     { label: "Info",        icon: "◆" },
    lti:      { label: "External",    icon: "◇" },
    assign:   { label: "Assignment",  icon: "✎" },
    hvp:      { label: "Interactive", icon: "✦" },
    quiz:     { label: "Quiz",        icon: "?" }
  };

  // ---------------- Data loading ----------------
  // Boot is triggered by auth.js: after login when Supabase is configured,
  // immediately in open-preview mode otherwise.
  window.__COURSE_BOOT__ = function () {
    (window.__COURSE_DATA__ ? Promise.resolve(window.__COURSE_DATA__) : fetch("course_data.json").then(function (r) { return r.json(); })).then(function (data) {
      COURSE = data;
      if (backendOn() && window.CourseBackend.progress) {
        progress = window.CourseBackend.progress;
      }
      applyOverrides();
      buildFlatIndex();
      document.getElementById("app").className = "layout";
      document.getElementById("app").innerHTML = shellHtml();
      attachGlobalHandlers();
      window.addEventListener("hashchange", render);
      if (!location.hash) location.hash = "#/home";
      render();
    }).catch(function (err) {
      document.getElementById("app").innerHTML =
        '<div style="padding:60px;text-align:center;color:#c0392b;">Failed to load course data: ' + escapeHtml(err) + "</div>";
    });
  };

  // Teacher edits are stored as per-activity overrides; apply them over the base data.
  function applyOverrides() {
    var ov = (window.CourseBackend && window.CourseBackend.overrides) || {};
    COURSE.sections.forEach(function (sec) {
      sec.activities.forEach(function (act) {
        var o = ov[act.id];
        if (!o) return;
        if (!act._orig) act._orig = { title: act.title, intro: act.intro, content: act.content };
        if (o.title != null && o.title !== "") act.title = o.title;
        if (o.intro != null) act.intro = o.intro;
        if (o.content != null) act.content = o.content;
      });
    });
  }

  function buildFlatIndex() {
    COURSE.sections.forEach(function (sec) {
      sec.activities.forEach(function (act, i) {
        var entry = { id: act.id, section: sec, activity: act };
        FLAT.push(entry);
        BY_ID[act.id] = entry;
      });
    });
  }

  // ---------------- Shell ----------------
  function shellHtml() {
    return (
      '<div id="sidebar-backdrop"></div>' +
      '<aside id="sidebar"></aside>' +
      '<div id="main">' +
      '<div id="topbar">' +
      '<button id="burger" aria-label="menu">☰</button>' +
      '<div class="crumbs" id="crumbs"></div>' +
      '<div class="spacer"></div>' +
      userChipHtml() +
      '<button class="nav-btn" id="prevBtn">← Prev</button>' +
      '<button class="nav-btn" id="nextBtn">Next →</button>' +
      "</div>" +
      '<div id="content"></div>' +
      '<footer class="site-footer">Independent-study edition, generated from the original course backup. Not affiliated with or endorsed by the original institution.</footer>' +
      "</div>"
    );
  }

  function userChipHtml() {
    if (!backendOn() || !window.CourseBackend.user) return "";
    var u = window.CourseBackend.user;
    var name = (window.CourseBackend.profile && window.CourseBackend.profile.full_name) || u.email;
    return '<div class="user-chip">' +
      (isTeacher() ? '<span class="role-badge teacher">Teacher</span>' : '<span class="role-badge">Learner</span>') +
      '<span class="user-name" title="' + escapeHtml(u.email) + '">' + escapeHtml(name) + "</span>" +
      '<button class="nav-btn" id="signOutBtn">Sign out</button></div>';
  }

  function attachGlobalHandlers() {
    var so = document.getElementById("signOutBtn");
    if (so) so.addEventListener("click", function () {
      window.CourseBackend.signOut();
    });
    document.getElementById("content").addEventListener("click", function (e) {
      var t = e.target.closest("[data-route]");
      if (t) { e.preventDefault(); location.hash = t.getAttribute("data-route"); }
    });
    document.getElementById("burger").addEventListener("click", function () {
      document.getElementById("sidebar").classList.toggle("open");
      document.getElementById("sidebar-backdrop").classList.toggle("show");
    });
    document.getElementById("sidebar-backdrop").addEventListener("click", function () {
      document.getElementById("sidebar").classList.remove("open");
      this.classList.remove("show");
    });
    document.getElementById("prevBtn").addEventListener("click", function () { gotoRelative(-1); });
    document.getElementById("nextBtn").addEventListener("click", function () { gotoRelative(1); });
  }

  function currentActivityFlatIndex() {
    var m = location.hash.match(/^#\/activity\/(.+)$/);
    if (!m) return -1;
    for (var i = 0; i < FLAT.length; i++) if (FLAT[i].id === m[1]) return i;
    return -1;
  }
  function gotoRelative(delta) {
    var i = currentActivityFlatIndex();
    if (i === -1) { if (FLAT.length) location.hash = "#/activity/" + FLAT[0].id; return; }
    var j = i + delta;
    if (j < 0 || j >= FLAT.length) return;
    location.hash = "#/activity/" + FLAT[j].id;
  }

  // ---------------- Progress helpers ----------------
  function isDone(act) {
    if (act.type === "quiz") {
      var q = progress.quiz[act.id];
      return !!(q && q.attempted);
    }
    return !!progress.viewed[act.id];
  }
  function isPassed(act) {
    if (act.type !== "quiz") return isDone(act);
    var q = progress.quiz[act.id];
    return !!(q && q.passed);
  }
  function sectionStats(sec) {
    var total = sec.activities.length, done = 0;
    sec.activities.forEach(function (a) { if (isDone(a)) done++; });
    return { total: total, done: done, pct: total ? Math.round((done / total) * 100) : 0 };
  }
  function overallStats() {
    var total = FLAT.length, done = 0;
    FLAT.forEach(function (f) { if (isDone(f.activity)) done++; });
    return { total: total, done: done, pct: total ? Math.round((done / total) * 100) : 0 };
  }
  function certEligibility() {
    var nonQuizTotal = 0, nonQuizDone = 0, quizTotal = 0, quizPassed = 0;
    FLAT.forEach(function (f) {
      if (f.activity.type === "quiz") {
        if (f.activity.questions && f.activity.questions.length) {
          quizTotal++;
          if (isPassed(f.activity)) quizPassed++;
        }
      } else {
        nonQuizTotal++;
        if (isDone(f.activity)) nonQuizDone++;
      }
    });
    return {
      nonQuizTotal: nonQuizTotal, nonQuizDone: nonQuizDone,
      quizTotal: quizTotal, quizPassed: quizPassed,
      eligible: nonQuizDone === nonQuizTotal && quizPassed === quizTotal
    };
  }

  function firstIncompleteActivityId() {
    for (var i = 0; i < FLAT.length; i++) if (!isDone(FLAT[i].activity)) return FLAT[i].id;
    return FLAT.length ? FLAT[0].id : null;
  }

  // ---------------- Render orchestration ----------------
  function render() {
    renderSidebar();
    var hash = location.hash || "#/home";
    var content = document.getElementById("content");
    var crumbs = document.getElementById("crumbs");
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-backdrop").classList.remove("show");

    var actMatch = hash.match(/^#\/activity\/(.+)$/);
    if (hash === "#/home" || hash === "#/" || hash === "") {
      crumbs.innerHTML = "<b>Course overview</b>";
      content.innerHTML = renderHome();
      togglePrevNext(null);
    } else if (hash === "#/certificate") {
      crumbs.innerHTML = "<b>Certificate</b>";
      content.innerHTML = renderCertificatePage();
      togglePrevNext(null);
      wireCertificatePage();
    } else if (actMatch && BY_ID[actMatch[1]]) {
      var entry = BY_ID[actMatch[1]];
      crumbs.innerHTML = "Week " + entry.section.number + " &middot; <b>" + escapeHtml(entry.activity.title) + "</b>";
      content.innerHTML = renderActivityWrap(entry);
      wireActivity(entry);
      togglePrevNext(entry);
      if (entry.activity.type !== "quiz") {
        progress.viewed[entry.activity.id] = true;
        saveProgress();
      }
    } else {
      location.hash = "#/home";
    }
    window.scrollTo(0, 0);
  }

  function togglePrevNext(entry) {
    var i = entry ? FLAT.findIndex(function (f) { return f.id === entry.id; }) : -1;
    document.getElementById("prevBtn").disabled = i <= 0;
    document.getElementById("nextBtn").disabled = i === -1 || i >= FLAT.length - 1;
  }

  // ---------------- Sidebar ----------------
  function renderSidebar() {
    var sb = document.getElementById("sidebar");
    var overall = overallStats();
    var curId = (location.hash.match(/^#\/activity\/(.+)$/) || [])[1];
    if (curId && BY_ID[curId]) openSections[BY_ID[curId].section.id] = true;
    if (!Object.keys(openSections).length && COURSE.sections.length) openSections[COURSE.sections[0].id] = true;

    var html = "";
    html += '<div class="brand"><div class="tag">Independent-study MOOC</div>' +
      "<h1>" + escapeHtml(COURSE.course.title) + "</h1>" +
      '<div class="instructor">Based on a course by Abdulkarim Abdulrakhmanuly</div></div>';
    html += '<div class="overall-progress"><div class="pct">' + overall.done + " / " + overall.total + " complete</div>" +
      '<div class="pbar"><div style="width:' + overall.pct + '%"></div></div>' +
      '<button id="resetProgressBtn" style="margin-top:10px;background:none;border:none;color:#7fa2e0;font-size:11px;cursor:pointer;padding:0;">Reset my progress</button></div>';
    html += "<nav>";
    html += '<a class="nav-home-link' + (location.hash === "#/home" || !location.hash ? " active" : "") + '" data-route="#/home">⌂&nbsp; Course Home</a>';
    html += '<a class="nav-cert-link' + (location.hash === "#/certificate" ? " active" : "") + '" data-route="#/certificate">🎓&nbsp; Certificate</a>';

    COURSE.sections.forEach(function (sec) {
      var st = sectionStats(sec);
      var open = !!openSections[sec.id];
      html += '<div class="section-block' + (open ? " open" : "") + '" data-sec="' + sec.id + '">';
      html += '<div class="section-head' + (st.done === st.total ? " done" : "") + '">' +
        '<span class="num">' + sec.number + "</span>" +
        "<span>" + escapeHtml(sec.name) + "</span>" +
        '<span class="section-progress-mini">' + st.done + "/" + st.total + "</span>" +
        '<span class="chev">▸</span></div>';
      html += '<ul class="activity-list">';
      sec.activities.forEach(function (act) {
        var meta = TYPE_META[act.type] || { icon: "•" };
        var active = curId === act.id;
        var extra = "";
        if (act.type === "quiz") {
          var q = progress.quiz[act.id];
          if (q && q.attempted) {
            extra = '<span class="quizscore ' + (q.passed ? "qscore-pass" : "qscore-fail") + '">' + Math.round(q.score * 100) + "%</span>";
          }
        } else if (isDone(act)) {
          extra = '<span class="check">✓</span>';
        }
        html += '<li><a class="activity-link' + (active ? " active" : "") + '" data-route="#/activity/' + act.id + '">' +
          '<span class="ico">' + meta.icon + "</span>" +
          '<span class="lbl">' + escapeHtml(act.title) + "</span>" + extra + "</a></li>";
      });
      html += "</ul></div>";
    });
    html += "</nav>";
    sb.innerHTML = html;

    sb.querySelectorAll(".section-head").forEach(function (el) {
      el.addEventListener("click", function () {
        var block = el.closest(".section-block");
        var id = block.getAttribute("data-sec");
        openSections[id] = !openSections[id];
        block.classList.toggle("open", openSections[id]);
      });
    });
    sb.querySelectorAll("[data-route]").forEach(function (el) {
      el.addEventListener("click", function () { location.hash = el.getAttribute("data-route"); });
    });
    var resetBtn = document.getElementById("resetProgressBtn");
    if (resetBtn) resetBtn.addEventListener("click", function () {
      if (confirm("Reset all your progress, quiz scores and certificate data?")) {
        localStorage.removeItem(STORAGE_KEY);
        progress = { viewed: {}, quiz: {}, name: "", certId: "" };
        quizStarted = {};
        saveProgress();
        location.hash = "#/home";
        render();
      }
    });
  }

  // ---------------- Home ----------------
  function renderHome() {
    var overall = overallStats();
    var elig = certEligibility();
    var quizCount = FLAT.filter(function (f) { return f.activity.type === "quiz" && f.activity.questions && f.activity.questions.length; }).length;
    var contId = overall.done === overall.total ? FLAT[0].id : firstIncompleteActivityId();
    var ctaLabel = overall.done === 0 ? "Start the course" : (overall.done === overall.total ? "Review the course" : "Continue where you left off");

    var html = "";
    html += '<div class="hero"><div class="tag">Free self-paced course</div>';
    html += "<h1>" + escapeHtml(COURSE.course.title) + "</h1>";
    html += '<p>' + safeHtml(COURSE.course.summary || "A structured, self-paced introduction to Information &amp; Communication Technology &mdash; work through each week, pass the quizzes, and earn a certificate of completion.") + "</p>";
    html += '<div class="cta-row">' +
      '<a class="btn btn-primary" data-route="#/activity/' + contId + '">' + ctaLabel + " →</a>" +
      '<a class="btn btn-outline" data-route="#/certificate">View certificate</a>' +
      "</div></div>";

    html += '<div class="stat-row">' +
      '<div class="stat-card"><div class="n">' + COURSE.sections.length + '</div><div class="l">Weeks</div></div>' +
      '<div class="stat-card"><div class="n">' + FLAT.length + '</div><div class="l">Learning items</div></div>' +
      '<div class="stat-card"><div class="n">' + quizCount + '</div><div class="l">Graded quizzes</div></div>' +
      "</div>";

    html += "<h2>Course outline</h2>";
    COURSE.sections.forEach(function (sec) {
      var st = sectionStats(sec);
      var first = sec.activities.length ? sec.activities[0].id : null;
      html += '<div class="section-card' + (st.done === st.total ? " done" : "") + '">';
      html += '<div class="top"><div class="badge">' + sec.number + "</div><div>";
      html += "<h3>" + escapeHtml(sec.name) + "</h3>";
      html += '<div class="meta">' + sec.activities.length + " items &middot; " + st.done + "/" + st.total + " complete</div>";
      html += "</div>";
      if (first) html += '<button class="go" data-route="#/activity/' + first + '">Open →</button>';
      html += "</div>";
      html += '<div class="pbar"><div style="width:' + st.pct + '%"></div></div>';
      html += "</div>";
    });

    html = html.replace(/data-route="([^"]+)"/g, 'data-route="$1" href="javascript:void(0)"');
    return html;
  }

  // ---------------- Activity dispatch ----------------
  function renderActivityWrap(entry) {
    var act = entry.activity;
    var meta = TYPE_META[act.type] || { label: act.type };
    var html = "";
    if (isTeacher()) {
      var edited = !!(window.CourseBackend.overrides && window.CourseBackend.overrides[act.id]);
      html += '<div class="teacher-bar"><span class="role-badge teacher">Teacher tools</span>' +
        '<button class="btn btn-outline btn-sm" id="editActivityBtn">✎ Edit this page</button>' +
        (edited ? '<button class="btn btn-outline btn-sm" id="resetOverrideBtn">Restore original</button><span class="edited-note">edited</span>' : "") +
        "</div>";
    }
    html += '<div class="crumb-type">' + meta.label + "</div>";
    html += '<h1 class="activity-title">' + escapeHtml(act.title) + "</h1>";
    html += renderActivityBody(entry);
    return html;
  }

  // ---------------- Teacher in-page editor ----------------
  function renderEditor(entry) {
    var act = entry.activity;
    var hasContentField = act.type === "page" || act.content != null;
    var c = document.getElementById("content");
    var html = '<div class="content-card edit-card">' +
      '<h2 style="margin-top:0;">Editing: ' + escapeHtml(act.title) + "</h2>" +
      '<p class="edit-hint">Changes are saved online and shown to every learner immediately. Formatting (bold, lists, links, images) is kept.</p>' +
      '<label class="edit-label">Title</label>' +
      '<input type="text" id="editTitle" class="edit-input" value="' + escapeHtml(act.title) + '"/>' +
      '<label class="edit-label">Description / introduction</label>' +
      '<div id="editIntro" class="edit-rich" contenteditable="true">' + safeHtml(act.intro || "") + "</div>";
    if (hasContentField) {
      html += '<label class="edit-label">Page content</label>' +
        '<div id="editContent" class="edit-rich edit-rich-tall" contenteditable="true">' + safeHtml(act.content || "") + "</div>";
    }
    html += '<div class="edit-actions">' +
      '<button class="btn btn-solid" id="saveEditBtn">Save changes</button>' +
      '<button class="btn btn-outline" id="cancelEditBtn">Cancel</button>' +
      '<span class="edit-status" id="editStatus"></span>' +
      "</div></div>";
    c.innerHTML = html;
    window.scrollTo(0, 0);

    document.getElementById("cancelEditBtn").addEventListener("click", function () { render(); });
    document.getElementById("saveEditBtn").addEventListener("click", function () {
      var st = document.getElementById("editStatus");
      var fields = {
        title: document.getElementById("editTitle").value.trim() || act.title,
        intro: document.getElementById("editIntro").innerHTML
      };
      if (hasContentField) fields.content = document.getElementById("editContent").innerHTML;
      st.textContent = "Saving…";
      window.CourseBackend.saveOverride(act.id, fields).then(function () {
        if (!act._orig) act._orig = { title: act.title, intro: act.intro, content: act.content };
        act.title = fields.title;
        act.intro = fields.intro;
        if (hasContentField) act.content = fields.content;
        render();
      }).catch(function (e) {
        st.textContent = "Save failed: " + (e.message || e);
        st.className = "edit-status err";
      });
    });
  }

  function restoreOriginal(entry) {
    var act = entry.activity;
    if (!confirm("Remove your edits and restore the original content of this page?")) return;
    window.CourseBackend.deleteOverride(act.id).then(function () {
      if (act._orig) {
        act.title = act._orig.title;
        act.intro = act._orig.intro;
        act.content = act._orig.content;
        delete act._orig;
      }
      render();
    }).catch(function (e) { alert("Could not restore: " + (e.message || e)); });
  }

  function renderActivityBody(entry) {
    var act = entry.activity;
    switch (act.type) {
      case "url": return renderUrl(act);
      case "resource": return renderFiles(act);
      case "folder": return renderFiles(act);
      case "page": return renderPage(act);
      case "book": return renderBook(act);
      case "lesson": return renderLesson(act);
      case "forum": return renderForum(act);
      case "data": return renderGeneric(act, "This was a collaborative database activity in the original course.");
      case "lti": return renderLti(act);
      case "assign": return renderAssign(act);
      case "hvp": return renderHvp(act);
      case "quiz": return renderQuiz(act);
      default: return '<div class="content-card">No content.</div>';
    }
  }

  function markCompleteRow(act) {
    if (act.type === "quiz") return "";
    return "";
  }

  function renderUrl(act) {
    var html = '<div class="content-card"><div class="prose">' + safeHtml(act.intro) + "</div>";
    if (act.externalurl) {
      html += '<a class="btn btn-solid external-link-btn" target="_blank" rel="noopener" href="' + escapeHtml(act.externalurl) + '">Open external resource ↗</a>';
    }
    html += "</div>";
    return html;
  }

  function fileIcon(mime) {
    if (!mime) return "▤";
    if (mime.indexOf("pdf") !== -1) return "PDF";
    if (mime.indexOf("image") !== -1) return "IMG";
    if (mime.indexOf("word") !== -1 || mime.indexOf("document") !== -1) return "DOC";
    if (mime.indexOf("presentation") !== -1) return "PPT";
    return "FILE";
  }

  function renderFiles(act) {
    var html = '<div class="content-card">';
    if (act.intro) html += '<div class="prose">' + safeHtml(act.intro) + "</div>";
    var files = act.files || [];
    if (files.length) {
      html += '<ul class="file-list">';
      files.forEach(function (f) {
        if (f.toolarge) {
          html += '<li class="file-item disabled"><div class="fico">' + fileIcon(f.mime) + '</div>' +
            '<div class="finfo"><div class="fname">' + escapeHtml(f.name) + '</div>' +
            '<div class="fsize">' + formatBytes(f.size) + " &middot; too large to host in this build</div></div>" +
            '<span class="fdl">Unavailable</span></li>';
        } else {
          html += '<li class="file-item"><div class="fico">' + fileIcon(f.mime) + '</div>' +
            '<div class="finfo"><div class="fname">' + escapeHtml(f.name) + '</div>' +
            '<div class="fsize">' + formatBytes(f.size) + "</div></div>" +
            '<a class="fdl" href="' + f.path + '" target="_blank" rel="noopener">Open</a></li>';
        }
      });
      html += "</ul>";
    } else if (!act.intro) {
      html += '<p class="prose">No files were attached to this item.</p>';
    }
    html += "</div>";
    return html;
  }

  function renderPage(act) {
    var html = '<div class="content-card">';
    if (act.intro) html += '<div class="prose">' + safeHtml(act.intro) + "</div>";
    html += '<div class="prose">' + safeHtml(act.content) + "</div></div>";
    return html;
  }

  function renderBook(act) {
    var html = "";
    if (act.intro) html += '<div class="content-card"><div class="prose">' + safeHtml(act.intro) + "</div></div>";
    var chapters = act.chapters || [];
    html += '<div class="content-card">';
    if (chapters.length > 1) {
      html += '<div class="chapter-toc">';
      chapters.forEach(function (c, i) { html += '<a href="#ch' + i + '">' + escapeHtml(c.title) + "</a>"; });
      html += "</div>";
    }
    chapters.forEach(function (c, i) {
      html += '<div class="chapter" id="ch' + i + '"><h3>' + escapeHtml(c.title) + '</h3><div class="prose">' + safeHtml(c.content) + "</div></div>";
    });
    if (!chapters.length) html += '<p class="prose">No chapters.</p>';
    html += "</div>";
    return html;
  }

  function renderLesson(act) {
    var html = '<div class="content-card"><div class="prose">' + safeHtml(act.intro) + "</div>";
    html += '<div class="note-box">This item was an interactive branching lesson in the original course. It has been simplified to a reading/viewing page here &mdash; work through the material above.</div>';
    html += "</div>";
    return html;
  }

  function renderForum(act) {
    return '<div class="content-card"><div class="prose">' + safeHtml(act.intro) + "</div></div>";
  }

  function renderGeneric(act, note) {
    var html = '<div class="content-card">';
    if (act.intro) html += '<div class="prose">' + safeHtml(act.intro) + "</div>";
    if (note) html += '<div class="note-box">' + note + "</div>";
    html += "</div>";
    return html;
  }

  function renderLti(act) {
    var html = '<div class="content-card">';
    if (act.intro) html += '<div class="prose">' + safeHtml(act.intro) + "</div>";
    html += '<div class="note-box">This was an externally-linked assessment tool (LTI) in the original course and could not be exported as static content.' +
      (act.toolurl ? ' <a href="' + escapeHtml(act.toolurl) + '" target="_blank" rel="noopener">Try the original link</a>.' : "") +
      "</div></div>";
    return html;
  }

  function renderAssign(act) {
    var html = '<div class="content-card">';
    if (act.intro) html += '<div class="prose">' + safeHtml(act.intro) + "</div>";
    if (act.duedate && act.duedate !== "0") {
      var d = new Date(parseInt(act.duedate, 10) * 1000);
      html += '<div class="quiz-chip">Original due date: ' + d.toLocaleDateString() + "</div>";
    }
    var files = (act.files || []).filter(function (f) { return !f.toolarge; });
    if (files.length) {
      html += '<ul class="file-list" style="margin-top:14px;">';
      files.forEach(function (f) {
        html += '<li class="file-item"><div class="fico">' + fileIcon(f.mime) + '</div>' +
          '<div class="finfo"><div class="fname">' + escapeHtml(f.name) + '</div><div class="fsize">' + formatBytes(f.size) + "</div></div>" +
          '<a class="fdl" href="' + f.path + '" target="_blank" rel="noopener">Open</a></li>';
      });
      html += "</ul>";
    }
    html += '<div class="note-box">This is a self-directed assignment &mdash; there is no file upload here. Complete the task on your own using the tools described above, then mark it done.</div>';
    html += '<div class="mark-complete-row"><input type="checkbox" id="assignDone" ' + (progress.viewed[act.id] ? "checked" : "") + '/><label for="assignDone">I completed this assignment</label></div>';
    html += "</div>";
    return html;
  }

  function renderHvp(act) {
    var html = '<div class="content-card">';
    if (act.intro) html += '<div class="prose">' + safeHtml(act.intro) + "</div>";
    if (act.machine_name === "H5P.Crossword" && act.crossword_words && act.crossword_words.length) {
      html += '<p class="prose">Fill in the answer for each clue, then check your work.</p><div id="crossword">';
      act.crossword_words.forEach(function (w, i) {
        html += '<div class="crossword-clue"><div style="flex:1;">' + (i + 1) + ". " + escapeHtml(w.clue) + '</div>' +
          '<input type="text" data-answer="' + escapeHtml(w.answer.toUpperCase()) + '" id="cw' + i + '"/></div>';
      });
      html += '</div><button class="btn btn-solid" id="checkCrossword" style="margin-top:14px;">Check answers</button>' +
        '<div id="crosswordResult" style="margin-top:10px;"></div>';
    } else {
      html += '<div class="note-box">This was an interactive H5P activity (' + escapeHtml(act.machine_name || "") + ') in the original course. Interactive playback isn’t available in this export.</div>';
    }
    html += "</div>";
    return html;
  }

  // ---------------- Quiz engine ----------------
  function renderQuiz(act) {
    var prevResult = progress.quiz[act.id];
    if (!act.questions || !act.questions.length) {
      return renderGeneric(act, "This quiz had no gradable questions in the original course (it may have linked to an external form).") +
        (act.intro ? "" : "");
    }
    if (!quizStarted[act.id] && !(prevResult && prevResult.attempted)) {
      return renderQuizIntro(act);
    }
    if (prevResult && prevResult.attempted && !quizState["_retaking_" + act.id]) {
      return renderQuizResult(act, prevResult, prevResult.detail);
    }
    return renderQuizForm(act);
  }

  function renderQuizIntro(act) {
    var html = '<div class="content-card">';
    if (act.intro) html += '<div class="prose">' + safeHtml(act.intro) + "</div>";
    html += '<div class="quiz-meta-row">' +
      '<span class="quiz-chip">' + act.questions.length + " question" + (act.questions.length > 1 ? "s" : "") + "</span>" +
      '<span class="quiz-chip">Pass mark: ' + Math.round(PASS_THRESHOLD * 100) + "%</span>";
    if (act.timelimit) html += '<span class="quiz-chip">Suggested time: ' + Math.round(act.timelimit / 60) + " min</span>";
    html += "</div>";
    html += '<button class="btn btn-solid" id="startQuizBtn">Start quiz →</button>';
    html += "</div>";
    return html;
  }

  function renderQuizForm(act) {
    quizState = quizState || {};
    var html = '<div class="content-card"><div class="prose">' + safeHtml(act.intro || "") + "</div></div>";
    act.questions.forEach(function (q, i) {
      html += '<div class="quiz-question" data-qid="' + q.id + '">';
      html += '<div class="qnum">Question ' + (i + 1) + " of " + act.questions.length + "</div>";
      html += '<div class="qtext">' + safeHtml(q.questiontext || q.name) + "</div>";
      html += renderQuestionInput(q);
      html += "</div>";
    });
    html += '<div class="quiz-submit-bar"><button class="btn btn-solid" id="submitQuizBtn">Submit quiz</button>' +
      '<span style="font-size:12.5px;color:#5b6577;">Answer every question you can, then submit for instant results.</span></div>';
    return html;
  }

  function renderQuestionInput(q) {
    var html = "";
    if (q.qtype === "multichoice") {
      var opts = q._shuffled || (q._shuffled = shuffle(q.answers.map(function (a, i) { return i; })));
      var itype = q.single === false ? "checkbox" : "radio";
      opts.forEach(function (idx) {
        var a = q.answers[idx];
        html += '<label class="opt-row"><input type="' + itype + '" name="q_' + q.id + '" value="' + idx + '"/>' +
          '<span>' + safeHtml(a.text) + "</span></label>";
      });
    } else if (q.qtype === "truefalse") {
      (q.answers || []).forEach(function (a, idx) {
        html += '<label class="opt-row"><input type="radio" name="q_' + q.id + '" value="' + idx + '"/>' +
          '<span>' + escapeHtml(stripTags(a.text)) + "</span></label>";
      });
    } else if (q.qtype === "match") {
      var rightOptions = shuffle((q.matches || []).map(function (m) { return m.answer; }));
      (q.matches || []).forEach(function (m, idx) {
        html += '<div class="match-row" data-idx="' + idx + '"><div class="mleft">' + safeHtml(m.question) + '</div>' +
          '<select data-qid="' + q.id + '" data-idx="' + idx + '"><option value="">— choose —</option>';
        rightOptions.forEach(function (opt) {
          html += '<option value="' + escapeHtml(opt) + '">' + escapeHtml(opt) + "</option>";
        });
        html += "</select></div>";
      });
    } else if (q.qtype === "shortanswer") {
      html += '<input type="text" class="short-answer" name="q_' + q.id + '" placeholder="Type your answer"/>';
    } else if (q.qtype === "essay") {
      html += '<textarea class="essay-box" name="q_' + q.id + '" placeholder="Write your reflection (not auto-graded)"></textarea>';
    } else {
      html += '<div class="note-box">Unsupported question type: ' + q.qtype + "</div>";
    }
    return html;
  }

  function gradeQuiz(act) {
    var totalPossible = 0, totalEarned = 0;
    var detail = [];
    act.questions.forEach(function (q) {
      var maxmark = q.maxmark || q.defaultmark || 1;
      var qEl = document.querySelector('.quiz-question[data-qid="' + q.id + '"]');
      var earnedFrac = null; // null = ungraded (essay)
      var userAnswer = null;

      if (q.qtype === "multichoice") {
        var checked = qEl.querySelectorAll('input[name="q_' + q.id + '"]:checked');
        var sum = 0; var picks = [];
        checked.forEach(function (c) { var idx = parseInt(c.value, 10); sum += q.answers[idx].fraction; picks.push(idx); });
        earnedFrac = Math.max(0, Math.min(1, sum));
        userAnswer = picks;
      } else if (q.qtype === "truefalse") {
        var c2 = qEl.querySelector('input[name="q_' + q.id + '"]:checked');
        earnedFrac = c2 ? q.answers[parseInt(c2.value, 10)].fraction : 0;
        userAnswer = c2 ? parseInt(c2.value, 10) : null;
      } else if (q.qtype === "match") {
        var selects = qEl.querySelectorAll("select");
        var correct = 0;
        selects.forEach(function (s) {
          var idx = parseInt(s.getAttribute("data-idx"), 10);
          if (s.value && s.value === q.matches[idx].answer) correct++;
        });
        earnedFrac = q.matches.length ? correct / q.matches.length : 0;
        userAnswer = "n/a";
      } else if (q.qtype === "shortanswer") {
        var inp = qEl.querySelector(".short-answer");
        var val = (inp.value || "").trim().toLowerCase();
        var ok = (q.answers || []).some(function (a) { return a.fraction >= 1 && stripTags(a.text).trim().toLowerCase() === val; });
        earnedFrac = val ? (ok ? 1 : 0) : 0;
        userAnswer = val;
      } else if (q.qtype === "essay") {
        earnedFrac = null;
      }

      if (earnedFrac !== null) {
        totalPossible += maxmark;
        totalEarned += earnedFrac * maxmark;
      }
      detail.push({ id: q.id, earnedFrac: earnedFrac });
    });

    var score = totalPossible > 0 ? totalEarned / totalPossible : 1;
    return { score: score, passed: score >= PASS_THRESHOLD, attempted: true, detail: detail, at: Date.now() };
  }

  function renderQuizResult(act, result, detail) {
    var html = '<div class="quiz-result-card">';
    html += '<div class="score ' + (result.passed ? "pass" : "fail") + '">' + Math.round(result.score * 100) + "%</div>";
    html += '<div class="verdict ' + (result.passed ? "pass" : "fail") + '">' + (result.passed ? "Passed ✓" : "Not yet passed") + "</div>";
    html += '<p style="color:#5b6577;font-size:13.5px;">Pass mark is ' + Math.round(PASS_THRESHOLD * 100) + "%. You can retake this quiz any time.</p>";
    html += '<button class="btn btn-solid" id="retakeQuizBtn">Retake quiz</button>';
    html += "</div>";

    act.questions.forEach(function (q, i) {
      var d = (detail || []).filter(function (x) { return x.id === q.id; })[0];
      html += '<div class="quiz-question"><div class="qnum">Question ' + (i + 1) + "</div>";
      html += '<div class="qtext">' + safeHtml(q.questiontext || q.name) + "</div>";
      if (q.qtype === "multichoice" || q.qtype === "truefalse") {
        (q.answers || []).forEach(function (a) {
          var cls = a.fraction > 0 ? "correct" : "";
          html += '<div class="opt-row ' + cls + '">' + safeHtml(a.text) + (a.fraction > 0 ? " ✓" : "") + "</div>";
        });
      } else if (q.qtype === "match") {
        (q.matches || []).forEach(function (m) {
          html += '<div class="match-row"><div class="mleft">' + safeHtml(m.question) + "</div><div><b>" + escapeHtml(m.answer) + "</b></div></div>";
        });
      } else if (q.qtype === "shortanswer") {
        var correctAns = (q.answers || []).filter(function (a) { return a.fraction >= 1; }).map(function (a) { return stripTags(a.text); }).join(", ");
        html += '<div class="feedback-note ok">Accepted answer(s): ' + escapeHtml(correctAns) + "</div>";
      } else if (q.qtype === "essay") {
        html += '<div class="note-box">Reflection question &mdash; not auto-graded.</div>';
      }
      if (d && d.earnedFrac !== null) {
        html += '<div class="feedback-note ' + (d.earnedFrac >= 0.999 ? "ok" : "bad") + '">You scored ' + Math.round(d.earnedFrac * 100) + "% on this question.</div>";
      }
      html += "</div>";
    });
    return html;
  }

  // ---------------- Wiring per activity ----------------
  function wireActivity(entry) {
    var act = entry.activity;

    var editBtn = document.getElementById("editActivityBtn");
    if (editBtn) editBtn.addEventListener("click", function () { renderEditor(entry); });
    var restoreBtn = document.getElementById("resetOverrideBtn");
    if (restoreBtn) restoreBtn.addEventListener("click", function () { restoreOriginal(entry); });

    if (act.type === "assign") {
      var cb = document.getElementById("assignDone");
      if (cb) cb.addEventListener("change", function () {
        progress.viewed[act.id] = cb.checked;
        saveProgress();
        renderSidebar();
      });
    }

    if (act.type === "hvp") {
      var btn = document.getElementById("checkCrossword");
      if (btn) btn.addEventListener("click", function () {
        var inputs = document.querySelectorAll("#crossword input");
        var correct = 0;
        inputs.forEach(function (inp) {
          var ok = (inp.value || "").trim().toUpperCase() === inp.getAttribute("data-answer");
          inp.style.borderColor = ok ? "#16a34a" : "#dc2626";
          if (ok) correct++;
        });
        document.getElementById("crosswordResult").innerHTML =
          '<div class="feedback-note ' + (correct === inputs.length ? "ok" : "bad") + '">' + correct + " / " + inputs.length + " correct</div>";
        progress.viewed[act.id] = true;
        saveProgress();
        renderSidebar();
      });
    }

    if (act.type === "quiz" && act.questions && act.questions.length) {
      var startBtn = document.getElementById("startQuizBtn");
      if (startBtn) startBtn.addEventListener("click", function () {
        quizStarted[act.id] = true;
        render();
      });
      var submitBtn = document.getElementById("submitQuizBtn");
      if (submitBtn) submitBtn.addEventListener("click", function () {
        var result = gradeQuiz(act);
        var prev = progress.quiz[act.id];
        if (prev && prev.score > result.score) {
          // keep best score, but still show this attempt's review
          progress.quiz[act.id] = { score: prev.score, passed: prev.passed, attempted: true, detail: result.detail, at: Date.now() };
        } else {
          progress.quiz[act.id] = result;
        }
        delete quizState["_retaking_" + act.id];
        saveProgress();
        render();
      });
      var retakeBtn = document.getElementById("retakeQuizBtn");
      if (retakeBtn) retakeBtn.addEventListener("click", function () {
        quizState["_retaking_" + act.id] = true;
        quizStarted[act.id] = true;
        render();
      });
    }

    document.querySelectorAll("[data-route]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        location.hash = el.getAttribute("data-route");
      });
    });
  }

  // ---------------- Certificate ----------------
  function renderCertificatePage() {
    var elig = certEligibility();
    var html = '<h1 class="activity-title">Certificate of Completion</h1><div class="cert-wrap">';
    if (!elig.eligible) {
      html += '<div class="cert-locked"><h2>Not yet unlocked</h2>' +
        '<p style="color:#5b6577;">Finish every learning item and pass every quiz to unlock your certificate.</p>';
      html += '<ul class="cert-checklist">';
      html += '<li class="' + (elig.nonQuizDone === elig.nonQuizTotal ? "ok" : "") + '"><span class="dot"></span> Learning items completed: ' + elig.nonQuizDone + " / " + elig.nonQuizTotal + "</li>";
      html += '<li class="' + (elig.quizPassed === elig.quizTotal ? "ok" : "") + '"><span class="dot"></span> Quizzes passed (≥' + Math.round(PASS_THRESHOLD * 100) + "%): " + elig.quizPassed + " / " + elig.quizTotal + "</li>";
      html += "</ul>";
      var nextId = firstIncompleteActivityId();
      if (nextId) html += '<a class="btn btn-solid" data-route="#/activity/' + nextId + '">Continue course →</a>';
      html += "</div>";
    } else {
      html += '<div class="cert-ready"><h2>🎉 You&rsquo;ve completed the course!</h2>' +
        '<p style="color:#5b6577;">Enter your full name as you&rsquo;d like it to appear on the certificate.</p>' +
        '<input type="text" id="certName" placeholder="Your full name" value="' + escapeHtml(progress.name || "") + '"/>';
      html += '<div class="cert-preview" id="certPreview">' + certPreviewHtml(progress.name || "Your Name") + "</div>";
      html += '<button class="btn btn-solid" id="downloadCertBtn">Download certificate (PDF)</button>';
      html += "</div>";
    }
    html += "</div>";
    html = html.replace(/data-route="([^"]+)"/g, 'data-route="$1" href="javascript:void(0)"');
    return html;
  }

  function ensureCertId() {
    if (!progress.certId) {
      progress.certId = "MDE173-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      saveProgress();
    }
    return progress.certId;
  }

  function certPreviewHtml(name) {
    var d = new Date();
    return '<div class="cbrand">Independent-Study MOOC</div>' +
      "<h2>This certifies that</h2>" +
      '<div class="name">' + escapeHtml(name) + "</div>" +
      '<h2>has successfully completed the course</h2>' +
      '<div class="course">' + escapeHtml(COURSE.course.title) + "</div>" +
      '<div class="cdate">Issued ' + d.toLocaleDateString() + " &middot; Certificate ID " + ensureCertId() + "</div>";
  }

  function wireCertificatePage() {
    var nameInput = document.getElementById("certName");
    if (nameInput) {
      nameInput.addEventListener("input", function () {
        document.getElementById("certPreview").innerHTML = certPreviewHtml(nameInput.value || "Your Name");
      });
    }
    var dl = document.getElementById("downloadCertBtn");
    if (dl) dl.addEventListener("click", function () {
      var name = (nameInput.value || "").trim();
      if (!name) { nameInput.style.borderColor = "#dc2626"; nameInput.focus(); return; }
      progress.name = name;
      saveProgress();
      generateCertificatePdf(name);
    });
    document.querySelectorAll("[data-route]").forEach(function (el) {
      el.addEventListener("click", function (e) { e.preventDefault(); location.hash = el.getAttribute("data-route"); });
    });
  }

  function generateCertificatePdf(name) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();

    doc.setFillColor(255, 255, 255); doc.rect(0, 0, W, H, "F");
    doc.setDrawColor(15, 37, 69); doc.setLineWidth(1.4); doc.rect(8, 8, W - 16, H - 16);
    doc.setDrawColor(37, 99, 235); doc.setLineWidth(0.5); doc.rect(11.5, 11.5, W - 23, H - 23);

    doc.setTextColor(37, 99, 235);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("INDEPENDENT-STUDY MOOC", W / 2, 30, { align: "center" });

    doc.setTextColor(15, 37, 69);
    doc.setFont("times", "bold"); doc.setFontSize(26);
    doc.text("Certificate of Completion", W / 2, 44, { align: "center" });

    doc.setTextColor(91, 101, 119);
    doc.setFont("times", "italic"); doc.setFontSize(13);
    doc.text("This certifies that", W / 2, 60, { align: "center" });

    doc.setTextColor(15, 37, 69);
    doc.setFont("times", "bolditalic"); doc.setFontSize(30);
    doc.text(name, W / 2, 74, { align: "center" });
    doc.setDrawColor(15, 37, 69); doc.setLineWidth(0.3);
    var tw = doc.getTextWidth(name);
    doc.line(W / 2 - tw / 2 - 6, 78, W / 2 + tw / 2 + 6, 78);

    doc.setTextColor(91, 101, 119);
    doc.setFont("times", "italic"); doc.setFontSize(13);
    doc.text("has successfully completed the self-paced course", W / 2, 90, { align: "center" });

    doc.setTextColor(15, 37, 69);
    doc.setFont("times", "bold"); doc.setFontSize(17);
    var title = COURSE.course.title;
    doc.text(title, W / 2, 100, { align: "center", maxWidth: W - 60 });

    var d = new Date();
    doc.setTextColor(91, 101, 119);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text("Issued on " + d.toLocaleDateString(), W / 2 - 60, H - 26, { align: "center" });
    doc.text("Certificate ID: " + ensureCertId(), W / 2 + 60, H - 26, { align: "center" });

    doc.setDrawColor(200, 200, 200);
    doc.line(W / 2 - 90, H - 34, W / 2 - 30, H - 34);
    doc.line(W / 2 + 30, H - 34, W / 2 + 90, H - 34);
    doc.setFontSize(9);
    doc.text("Course facilitator", W / 2 - 60, H - 29, { align: "center" });
    doc.text("Date issued", W / 2 + 60, H - 29, { align: "center" });

    doc.save("Certificate - " + name.replace(/[^A-Za-z0-9 _-]/g, "") + ".pdf");
  }

})();
/* build: supabase-auth-v1 */
