(() => {
  const KEY = "students.v1";
  const $ = id => document.getElementById(id);
  let students = [];

  async function request(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The request failed.");
    return data;
  }

  function esc(t) {
    return String(t ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function migrateLegacyStudents() {
    const stored = localStorage.getItem(KEY);
    if (!stored) return;
    const legacy = JSON.parse(stored);
    if (!Array.isArray(legacy)) throw new Error("Saved browser data could not be migrated.");
    if (legacy.length) {
      await request("/api/students/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacy)
      });
    }
    localStorage.removeItem(KEY);
  }

  async function loadStudents() {
    students = await request("/api/students");
    render();
    $("databaseStatus").textContent = `Connected to database · ${students.length} student${students.length === 1 ? "" : "s"} saved`;
    $("databaseStatus").classList.remove("error");
  }

  function showError(message) {
    $("error").textContent = message;
    $("databaseStatus").textContent = message;
    $("databaseStatus").classList.add("error");
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

  $("studentForm").addEventListener("submit", async e => {
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
    try {
      await request(id ? `/api/students/${encodeURIComponent(id)}` : "/api/students", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      await loadStudents();
      resetForm();
    } catch (error) {
      showError(error.message);
    }
  });

  $("cancelBtn").addEventListener("click", resetForm);
  $("search").addEventListener("input", render);
  $("filterGrade").addEventListener("change", render);

  $("rows").addEventListener("click", async e => {
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
        try {
          await request(`/api/students/${encodeURIComponent(del)}`, { method: "DELETE" });
          await loadStudents();
        } catch (error) {
          showError(error.message);
        }
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

  (async () => {
    $("databaseStatus").textContent = "Connecting to database…";
    try {
      await migrateLegacyStudents();
      await loadStudents();
    } catch (error) {
      showError(error.message);
    }
  })();
})();
