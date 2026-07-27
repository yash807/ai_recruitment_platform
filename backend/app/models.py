"""MongoDB data-access layer.

This file used to define SQLAlchemy ORM model classes. It now defines a
small repository per collection instead. Documents are plain dicts wrapped
in `Doc`, which allows attribute access (doc.name) as well as dict access
(doc["name"]) so most of the route code that used to read `student.name`
keeps working unchanged.

Every document gets an integer "id" field (from the "counters" collection,
incremented atomically) so ids stay compatible with the rest of the app and
the frontend - only the storage engine changed, not the shape of the data.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable

from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from .mongo import mongo_db


class DuplicateRecordError(Exception):
    """Raised on a unique-index clash. Replaces SQLAlchemy's IntegrityError."""


class Doc(dict):
    """A dict that also supports attribute access and assignment."""

    def __getattr__(self, name: str) -> Any:
        return self.get(name)

    def __setattr__(self, name: str, value: Any) -> None:
        self[name] = value


def _wrap(document: dict | None) -> Doc | None:
    if document is None:
        return None
    document.pop("_id", None)
    return Doc(document)


def _next_id(counter_name: str) -> int:
    """Atomically return the next integer id for one collection."""
    result = mongo_db["counters"].find_one_and_update(
        {"_id": counter_name},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return result["seq"]


class MongoRepository:
    collection_name: str = ""
    defaults: dict[str, Any] = {}

    def __init__(self) -> None:
        self.collection = mongo_db[self.collection_name]

    # --- reads -----------------------------------------------------------
    def get(self, id: int) -> Doc | None:
        return _wrap(self.collection.find_one({"id": id}))

    def find_one(self, filter: dict) -> Doc | None:
        return _wrap(self.collection.find_one(filter))

    def list(
        self,
        filter: dict | None = None,
        sort: list[tuple[str, int]] | None = None,
        limit: int | None = None,
    ) -> list[Doc]:
        cursor = self.collection.find(filter or {})
        if sort:
            cursor = cursor.sort(sort)
        if limit:
            cursor = cursor.limit(limit)
        return [Doc(_wrap(document)) for document in cursor]

    def many_by_id(self, ids: Iterable[int]) -> dict[int, Doc]:
        ids = list(set(ids))
        if not ids:
            return {}
        docs = self.collection.find({"id": {"$in": ids}})
        return {document["id"]: _wrap(document) for document in docs}

    def count(self, filter: dict | None = None) -> int:
        return self.collection.count_documents(filter or {})

    # --- writes ------------------------------------------------------------
    def create(self, data: dict[str, Any]) -> Doc:
        document = {**self.defaults, **data}
        document["id"] = _next_id(self.collection_name)
        document["created_at"] = datetime.now(timezone.utc)
        try:
            self.collection.insert_one(document)
        except DuplicateKeyError as error:
            raise DuplicateRecordError(str(error)) from error
        document.pop("_id", None)
        return Doc(document)

    def save(self, doc: Doc) -> Doc:
        """Persist a Doc you fetched earlier and then mutated in place."""
        to_store = dict(doc)
        to_store.pop("_id", None)
        self.collection.replace_one({"id": doc["id"]}, to_store, upsert=True)
        return doc

    def update(self, id: int, updates: dict[str, Any]) -> Doc | None:
        return _wrap(
            self.collection.find_one_and_update(
                {"id": id},
                {"$set": updates},
                return_document=ReturnDocument.AFTER,
            )
        )

    def delete(self, id: int) -> None:
        self.collection.delete_one({"id": id})


class StudentRepository(MongoRepository):
    collection_name = "students"
    defaults = {
        "password_hash": None,
        "college": None,
        "branch": None,
        "cgpa": None,
        "skills": None,
        "target_role": None,
        "linkedin_url": None,
        "github_url": None,
        "leetcode_url": None,
        "resume_path": None,
        "resume_text": None,
        "resume_score": 0,
        "role_match_score": 0,
        "mock_interview_score": 0,
        "ai_profile_summary": None,
    }

    def get_by_email(self, email: str) -> Doc | None:
        return self.find_one({"email": email})


class JobRepository(MongoRepository):
    collection_name = "jobs"
    defaults = {
        "job_description": None,
        "required_skills": None,
        "min_cgpa": None,
        "eligible_branch": "All",
        "location": None,
        "salary": None,
    }


class ApplicationRepository(MongoRepository):
    collection_name = "applications"
    defaults = {
        "match_score": 0,
        "company_interview_score": 0,
        "recruiter_review_score": 0,
        "final_score": 0,
        "recruiter_feedback": None,
        "eligible": False,
        "eligibility_reasons": "[]",
        "score_breakdown": "{}",
        "matched_skills": "[]",
        "missing_skills": "[]",
        "status": "Applied",
        "recommendation": "Pending",
    }

    def get_by_student_and_job(self, student_id: int, job_id: int) -> Doc | None:
        return self.find_one({"student_id": student_id, "job_id": job_id})

    def list_by_job(self, job_id: int, sort_by_match: bool = False) -> list[Doc]:
        sort = [("match_score", DESCENDING)] if sort_by_match else [("id", DESCENDING)]
        return self.list({"job_id": job_id}, sort=sort)

    def list_by_student(self, student_id: int) -> list[Doc]:
        return self.list({"student_id": student_id}, sort=[("id", DESCENDING)])

    def list_by_students(self, student_ids: Iterable[int]) -> list[Doc]:
        return self.list({"student_id": {"$in": list(student_ids)}})

    def student_ids_for_job(self, job_id: int) -> set[int]:
        return {
            document["student_id"]
            for document in self.collection.find({"job_id": job_id}, {"student_id": 1})
        }


class MockInterviewRepository(MongoRepository):
    collection_name = "mock_interviews"
    defaults = {
        "video_paths": "{}",
        "status": "In Progress",
        "transcripts": "[]",
        "ai_evaluation": None,
        "analysis_status": "Not Started",
        "analysis_error": None,
        "overall_score": 0,
    }


class CompanyInterviewRepository(MongoRepository):
    collection_name = "company_interviews"
    defaults = {
        "video_paths": "{}",
        "transcripts": "[]",
        "ai_evaluation": None,
        "status": "In Progress",
        "analysis_status": "Not Started",
        "analysis_error": None,
        "overall_score": 0,
    }

    def latest_for_application(self, application_id: int) -> Doc | None:
        documents = list(
            self.collection.find({"application_id": application_id})
            .sort("id", DESCENDING)
            .limit(1)
        )
        return _wrap(documents[0]) if documents else None


def ensure_indexes() -> None:
    """Create unique/lookup indexes. Safe to call on every startup."""
    mongo_db["students"].create_index("id", unique=True)
    mongo_db["students"].create_index("email", unique=True)

    mongo_db["jobs"].create_index("id", unique=True)

    mongo_db["applications"].create_index("id", unique=True)
    mongo_db["applications"].create_index(
        [("student_id", ASCENDING), ("job_id", ASCENDING)], unique=True
    )
    mongo_db["applications"].create_index("job_id")
    mongo_db["applications"].create_index("student_id")

    mongo_db["mock_interviews"].create_index("id", unique=True)
    mongo_db["mock_interviews"].create_index("student_id")

    mongo_db["company_interviews"].create_index("id", unique=True)
    mongo_db["company_interviews"].create_index("application_id")


students = StudentRepository()
jobs = JobRepository()
applications = ApplicationRepository()
mock_interviews = MockInterviewRepository()
company_interviews = CompanyInterviewRepository()
