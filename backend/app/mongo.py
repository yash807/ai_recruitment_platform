import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI")

client = MongoClient(MONGODB_URI)
mongo_db = client["ai_recruitment_platform"]  # you can rename this database

# Example: mongo_db["some_collection"] to get/create a collection later