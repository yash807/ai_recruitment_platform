"""Shared job-role requirements used by resume matching and mock interviews."""

# Each role contains:
# - core_skills: essential skills worth 60 points in role matching
# - supporting_skills: useful additional skills worth 20 points
# - role_terms: job-title phrases that show clear role alignment
# - project_advice: an honest project recommendation for the student
# - interview_questions: two technical questions used in the mock interview
ROLE_PROFILES = {
    "AI/ML Intern": {
        "core_skills": {
            "Python": ("python",),
            "Machine Learning": ("machine learning", "ml model", "scikit-learn", "sklearn"),
            "Data preprocessing": ("data preprocessing", "data cleaning", "feature engineering"),
            "Pandas": ("pandas",),
            "NumPy": ("numpy",),
        },
        "supporting_skills": {
            "SQL": ("sql", "mysql", "postgresql"),
            "Model evaluation": ("model evaluation", "accuracy", "precision", "recall", "f1 score"),
            "Deployment": ("deployment", "deployed", "fastapi", "flask", "streamlit"),
        },
        "role_terms": ("ai intern", "ml intern", "machine learning intern", "data science intern"),
        "project_advice": "Build one end-to-end ML project that explains the dataset, preprocessing, model choice, evaluation metric, and final result.",
        "interview_questions": (
            "Explain the difference between training data, validation data, and test data.",
            "Choose one machine-learning project from your resume. How did you evaluate whether the model was useful?",
        ),
    },
    "Data Analyst": {
        "core_skills": {
            "SQL": ("sql", "mysql", "postgresql"),
            "Excel": ("excel", "spreadsheet"),
            "Data cleaning": ("data cleaning", "data preprocessing", "missing values"),
            "Data visualization": ("data visualization", "dashboard", "charts"),
            "Statistics": ("statistics", "statistical", "hypothesis testing"),
        },
        "supporting_skills": {
            "Python": ("python", "pandas"),
            "Power BI": ("power bi", "powerbi"),
            "Tableau": ("tableau",),
        },
        "role_terms": ("data analyst", "business analyst", "analytics intern"),
        "project_advice": "Add an analysis project that starts with a business question and ends with measurable findings or a dashboard.",
        "interview_questions": (
            "How would you clean a dataset containing duplicates, missing values, and inconsistent categories?",
            "Explain one dashboard or analysis project and the decision your findings could support.",
        ),
    },
    "Frontend Developer": {
        "core_skills": {
            "HTML": ("html",),
            "CSS": ("css", "tailwind"),
            "JavaScript": ("javascript",),
            "React": ("react", "next.js", "nextjs"),
            "Responsive design": ("responsive", "mobile-first"),
        },
        "supporting_skills": {
            "TypeScript": ("typescript",),
            "API integration": ("api integration", "rest api", "fetch", "axios"),
            "Testing": ("jest", "vitest", "cypress", "playwright"),
        },
        "role_terms": ("frontend developer", "front-end developer", "react developer"),
        "project_advice": "Include a deployed responsive frontend project and describe accessibility, performance, and API integration decisions.",
        "interview_questions": (
            "In React, what is the difference between props and state, and when would you use each?",
            "How did you make one of your projects responsive and accessible across devices?",
        ),
    },
    "Backend Developer": {
        "core_skills": {
            "Server-side language": ("python", "java", "node.js", "nodejs", "c#", "go"),
            "REST APIs": ("rest api", "restful", "fastapi", "django", "express", "spring boot"),
            "SQL": ("sql", "postgresql", "mysql"),
            "Database design": ("database design", "schema", "normalization"),
            "Authentication": ("authentication", "authorization", "jwt", "oauth"),
        },
        "supporting_skills": {
            "Git": ("git", "github"),
            "Docker": ("docker",),
            "Testing": ("unit testing", "pytest", "junit", "jest"),
        },
        "role_terms": ("backend developer", "back-end developer", "api developer"),
        "project_advice": "Add a backend project with documented APIs, authentication, database relationships, validation, and error handling.",
        "interview_questions": (
            "Explain how a request moves through one of your backend APIs from validation to the database response.",
            "How would you design authentication and authorization for an application with multiple user roles?",
        ),
    },
    "Full-Stack Developer": {
        "core_skills": {
            "JavaScript or TypeScript": ("javascript", "typescript"),
            "Frontend framework": ("react", "next.js", "nextjs", "angular", "vue"),
            "Backend framework": ("node.js", "nodejs", "express", "fastapi", "django", "spring boot"),
            "Database": ("sql", "postgresql", "mysql", "mongodb"),
            "API integration": ("rest api", "api integration", "fetch", "axios"),
        },
        "supporting_skills": {
            "Authentication": ("authentication", "jwt", "oauth"),
            "Git": ("git", "github"),
            "Deployment": ("deployment", "deployed", "vercel", "render", "aws", "docker"),
        },
        "role_terms": ("full-stack developer", "full stack developer", "software developer"),
        "project_advice": "Include one deployed end-to-end application and clearly separate your frontend, backend, database, and deployment contributions.",
        "interview_questions": (
            "Explain the complete data flow through one of your full-stack projects, from the user interface to the database.",
            "What technical trade-off did you make while connecting the frontend and backend of your project?",
        ),
    },
    "Software Developer": {
        "core_skills": {
            "Programming language": ("python", "java", "javascript", "typescript", "c++", "c#"),
            "Data structures": ("data structures", "dsa", "array", "linked list", "tree", "graph"),
            "Algorithms": ("algorithms", "algorithm"),
            "Object-oriented programming": ("object-oriented", "object oriented", "oop"),
            "Problem solving": ("problem solving", "problem-solving"),
        },
        "supporting_skills": {
            "Git": ("git", "github"),
            "Database": ("sql", "postgresql", "mysql", "mongodb"),
            "Testing": ("unit testing", "pytest", "junit", "jest"),
        },
        "role_terms": ("software developer", "software engineer", "developer intern"),
        "project_advice": "Add a substantial software project and describe the problem, design decisions, algorithms, testing, and measurable outcome.",
        "interview_questions": (
            "Choose a data structure you used in a project and explain why it was suitable.",
            "Describe a difficult programming problem you solved and analyze the time and space complexity of your approach.",
        ),
    },
}

# A simple tuple used to validate the role selected on the frontend.
TARGET_ROLES = tuple(ROLE_PROFILES)


def get_role_profile(role: str):
    """Return one role definition, or None when the role is unsupported."""
    return ROLE_PROFILES.get(role)
