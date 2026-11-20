(() => {
  const KEY = "students.v1";
  const $ = id => document.getElementById(id);
  let students = load();

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(students)); }
  function nextId() {
    const n = students.reduce((m, s) => Math.max(m, parseInt(s.id.slice(1), 10) || 0), 0) + 1;
    return "S" + String(n).padStart(4, "0");
  }
  function esc(t) {
    return String(t ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Fill class filter from the form's options
  [...$("grade").options].forEach(o => {
    const f = document.createElement("option");
    f.value = f.textContent = o.value;
    $("filterGrade").appendChild(f);
  });

  function render() {
    const q = $("search").value.trim().toLowerCase();
    const g = $("filterGrade").value;
    const shown = students.filter(s =>
      (!g || s.grade === g) &&
      (!q || s.name.toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q)));

    $("rows").innerHTML = shown.map(s => {
      const cls = s.score >= 80 ? "good" : s.score >= 50 ? "mid" : "low";
      return `<tr>
        <td>${esc(s.id)}</td>
        <td>${esc(s.name)}<small>${esc(s.gender)}</small></td>
        <td>${esc(s.grade)}</td>
        <td>${esc(s.email) || "–"}<small>${esc(s.phone)}</small></td>
        <td class="score ${cls}">${s.score}</td>
        <td><div class="row-actions">
          <button data-edit="${s.id}">Edit</button>
          <button class="danger" data-del="${s.id}">Delete</button>
        </div></td></tr>`;
    }).join("");
    $("empty").hidden = shown.length > 0;
    if (!shown.length && students.length) $("empty").textContent = "No students match your search.";
    else $("empty").textContent = "No students yet. Add the first one using the form.";

    const scores = students.map(s => s.score);
    $("statTotal").textContent = students.length;
    $("statAvg").textContent = scores.length
      ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "–";
    $("statTop").textContent = scores.length ? Math.max(...scores) : "–";
  }

  function resetForm() {
    $("studentForm").reset();
    $("editId").value = "";
    $("formTitle").textContent = "Add student";
    $("saveBtn").textContent = "Save student";
    $("cancelBtn").hidden = true;
    $("error").textContent = "";
  }

  $("studentForm").addEventListener("submit", e => {
    e.preventDefault();
    const name = $("name").value.trim();
    const score = Number($("score").value);
    const email = $("email").value.trim();
    if (!name) return ($("error").textContent = "Enter the student's full name.");
    if ($("score").value === "" || score < 0 || score > 100)
      return ($("error").textContent = "Score must be a number from 0 to 100.");
    if (email && !/^\S+@\S+\.\S+$/.test(email))
      return ($("error").textContent = "Enter a valid email, like name@example.com.");

    const data = {
      name, email, score,
      gender: $("gender").value, grade: $("grade").value, phone: $("phone").value.trim()
    };
    const id = $("editId").value;
    if (id) students = students.map(s => (s.id === id ? { ...s, ...data } : s));
    else students.push({ id: nextId(), ...data });
    save(); resetForm(); render();
  });

  $("cancelBtn").addEventListener("click", resetForm);
  $("search").addEventListener("input", render);
  $("filterGrade").addEventListener("change", render);

  $("rows").addEventListener("click", e => {
    const edit = e.target.dataset.edit, del = e.target.dataset.del;
    if (edit) {
      const s = students.find(x => x.id === edit);
      $("editId").value = s.id; $("name").value = s.name; $("gender").value = s.gender;
      $("grade").value = s.grade; $("email").value = s.email; $("phone").value = s.phone;
      $("score").value = s.score;
      $("formTitle").textContent = "Edit student";
      $("saveBtn").textContent = "Save changes";
      $("cancelBtn").hidden = false;
      $("name").focus();
    }
    if (del) {
      const s = students.find(x => x.id === del);
      if (confirm(`Delete ${s.name}? This cannot be undone.`)) {
        students = students.filter(x => x.id !== del);
        save(); render();
      }
    }
  });

  $("exportBtn").addEventListener("click", () => {
    const head = ["ID", "Name", "Gender", "Class", "Email", "Phone", "Score"];
    const lines = students.map(s =>
      [s.id, s.name, s.gender, s.grade, s.email, s.phone, s.score]
        .map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob(["\uFEFF" + [head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "students.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  render();
})();
