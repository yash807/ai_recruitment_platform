"""Single MongoDB connection shared by the whole backend.

Every route now reads/writes through this connection (via app/models.py)
instead of SQLite/SQLAlchemy. Set MONGODB_URI in your environment
(locally in backend/.env, and in Render's dashboard for production).
"""

import os

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.server_api import ServerApi

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI")
if not MONGODB_URI:
    raise RuntimeError(
        "MONGODB_URI is not set. Add it to backend/.env locally, and to your "
        "Render service's Environment Variables in production."
    )

# The DB name lives in the path of the URI if you added one
# (…mongodb.net/ai_recruitment_platform?...). If it's not there, we fall
# back to a fixed name so local and deployed runs use the same database.
client = MongoClient(MONGODB_URI, server_api=ServerApi("1"))
mongo_db = client.get_default_database(default="ai_recruitment_platform")
