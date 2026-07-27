import logging

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pymongo.errors import PyMongoError

from .models import ensure_indexes
from .mongo import mongo_db
from .routes import applications, college, company_interviews, interviews, jobs, students

logger = logging.getLogger(__name__)

# MongoDB is schemaless, so there is no "create tables" step. We only make
# sure the indexes we rely on (unique email, unique student+job pair, etc.)
# exist. This is safe to run every time the app starts.
try:
    ensure_indexes()
except PyMongoError:
    logger.exception("Could not create MongoDB indexes on startup.")
    raise

# Create the main FastAPI backend application.
app = FastAPI(title="AI Talent Intelligence Prototype")

# Allow the local Next.js frontend to call this backend from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://ai-recruitment-platform-kappa.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register APIs defined in separate route files.
app.include_router(students.router)
app.include_router(interviews.router)
app.include_router(jobs.router)
app.include_router(applications.router)
app.include_router(company_interviews.router)
app.include_router(college.router)


# Simple test endpoint for checking that the backend server is running.
@app.get("/")
def home():
    return {"message": "Backend is running"}


# The frontend calls this endpoint to display the system status.
@app.get("/health")
def health_check():
    """Report readiness only when the API can also reach MongoDB."""
    try:
        mongo_db.command("ping")
    except PyMongoError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The database is not available.",
        ) from error
    return {"status": "ok", "database": "ok"}
