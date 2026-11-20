import json
import os
import re
import sqlite3
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


DATABASE_PATH = os.environ.get("STUDENT_DB_PATH", "students.sqlite3")
GRADES = {f"Grade {grade}" for grade in range(7, 13)}
GENDERS = {"Female", "Male"}
EMAIL_PATTERN = re.compile(r"^\S+@\S+\.\S+$")
STUDENT_PATH = re.compile(r"^/api/students/S([0-9]{1,12})$")


def connect():
    os.makedirs(os.path.dirname(os.path.abspath(DATABASE_PATH)), exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


@contextmanager
def database():
    connection = connect()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database():
    with database() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                gender TEXT NOT NULL,
                grade TEXT NOT NULL,
                email TEXT NOT NULL DEFAULT '',
                phone TEXT NOT NULL DEFAULT '',
                score REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def student_record(row):
    return {
        "id": f"S{row['id']:04d}",
        "name": row["name"],
        "gender": row["gender"],
        "grade": row["grade"],
        "email": row["email"],
        "phone": row["phone"],
        "score": row["score"],
    }


def validate_student(data):
    if not isinstance(data, dict):
        raise ValueError("Student data must be an object.")
    name = data.get("name")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 60:
        raise ValueError("Enter a name of 1 to 60 characters.")
    gender = data.get("gender")
    if not isinstance(gender, str) or gender not in GENDERS:
        raise ValueError("Select a valid gender.")
    grade = data.get("grade")
    if not isinstance(grade, str) or grade not in GRADES:
        raise ValueError("Select a valid class.")
    email = data.get("email", "")
    phone = data.get("phone", "")
    if not isinstance(email, str) or (email and not EMAIL_PATTERN.match(email)):
        raise ValueError("Enter a valid email address.")
    if not isinstance(phone, str) or len(phone) > 40:
        raise ValueError("Phone number must be 40 characters or fewer.")
    score = data.get("score")
    if isinstance(score, bool) or not isinstance(score, (int, float)) or not 0 <= score <= 100:
        raise ValueError("Score must be a number from 0 to 100.")
    return (name.strip(), gender, grade, email.strip(), phone.strip(), score)


class StudentHandler(BaseHTTPRequestHandler):
    def send_json(self, status, value):
        body = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 1024 * 1024:
                raise ValueError("Request body must be between 1 byte and 1 MB.")
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("Request body must contain valid JSON.") from None

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json(200, {"ok": True})
            return
        if path != "/api/students":
            self.send_json(404, {"error": "Not found."})
            return
        try:
            with database() as connection:
                rows = connection.execute("SELECT * FROM students ORDER BY id").fetchall()
        except sqlite3.Error:
            self.send_json(500, {"error": "Could not read students from the database."})
            return
        self.send_json(200, [student_record(row) for row in rows])

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            data = self.read_json()
            if path == "/api/students/import":
                result = self.import_legacy(data)
                self.send_json(200, result)
                return
            if path != "/api/students":
                self.send_json(404, {"error": "Not found."})
                return
            values = validate_student(data)
            with database() as connection:
                cursor = connection.execute(
                    "INSERT INTO students (name, gender, grade, email, phone, score) VALUES (?, ?, ?, ?, ?, ?)",
                    values,
                )
                row = connection.execute("SELECT * FROM students WHERE id = ?", (cursor.lastrowid,)).fetchone()
            self.send_json(201, student_record(row))
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except sqlite3.Error:
            self.send_json(500, {"error": "Could not save the student to the database."})

    def import_legacy(self, data):
        if not isinstance(data, list) or len(data) > 1000:
            raise ValueError("Legacy student data must be a list of at most 1,000 students.")
        values = []
        seen_ids = set()
        for student in data:
            validated = validate_student(student)
            match = re.fullmatch(r"S([0-9]{1,12})", str(student.get("id", "")))
            if not match or int(match.group(1)) < 1:
                raise ValueError("A saved student has an invalid ID and could not be migrated.")
            legacy_id = int(match.group(1))
            if legacy_id in seen_ids:
                raise ValueError("Saved student data contains duplicate IDs.")
            seen_ids.add(legacy_id)
            values.append((legacy_id, *validated))
        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            count = connection.execute("SELECT COUNT(*) FROM students").fetchone()[0]
            if count:
                return {"imported": 0}
            connection.executemany(
                "INSERT INTO students (id, name, gender, grade, email, phone, score) VALUES (?, ?, ?, ?, ?, ?, ?)",
                values,
            )
        return {"imported": len(values)}

    def do_PUT(self):
        match = STUDENT_PATH.fullmatch(urlparse(self.path).path)
        if not match:
            self.send_json(404, {"error": "Not found."})
            return
        student_id = int(match.group(1))
        try:
            values = validate_student(self.read_json())
            with database() as connection:
                cursor = connection.execute(
                    "UPDATE students SET name = ?, gender = ?, grade = ?, email = ?, phone = ?, score = ? WHERE id = ?",
                    (*values, student_id),
                )
                row = connection.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
            if cursor.rowcount == 0:
                self.send_json(404, {"error": "Student not found."})
                return
            self.send_json(200, student_record(row))
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except sqlite3.Error:
            self.send_json(500, {"error": "Could not update the student in the database."})

    def do_DELETE(self):
        match = STUDENT_PATH.fullmatch(urlparse(self.path).path)
        if not match:
            self.send_json(404, {"error": "Not found."})
            return
        try:
            with database() as connection:
                cursor = connection.execute("DELETE FROM students WHERE id = ?", (int(match.group(1)),))
        except sqlite3.Error:
            self.send_json(500, {"error": "Could not delete the student from the database."})
            return
        if cursor.rowcount == 0:
            self.send_json(404, {"error": "Student not found."})
            return
        self.send_json(200, {"deleted": True})

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}")


if __name__ == "__main__":
    initialize_database()
    server = ThreadingHTTPServer(("0.0.0.0", 8000), StudentHandler)
    print(f"Student API listening on port 8000; database: {DATABASE_PATH}")
    server.serve_forever()
