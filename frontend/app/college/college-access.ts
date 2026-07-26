export const COLLEGE_SESSION_KEY = "ai-talent-college-email";

export type CollegeIdentity = {
  email: string;
  collegeName: string;
  optionAliases: readonly string[];
};

type AllowedCollege = Omit<CollegeIdentity, "email"> & {
  domain: string;
};

const ALLOWED_COLLEGES: readonly AllowedCollege[] = [
  {
    domain: "galgotiasuniversity.edu",
    collegeName: "Galgotias University",
    optionAliases: ["Galgotias University", "GU", "gu"],
  },
  {
    domain: "amityuniversity.edu",
    collegeName: "Amity University",
    optionAliases: ["Amity University", "amity"],
  },
];

export function getCollegeIdentity(email: string): CollegeIdentity | null {
  const normalizedEmail = email.trim().toLowerCase();
  const [localPart, domain, ...extraParts] = normalizedEmail.split("@");

  if (localPart !== "placement" || !domain || extraParts.length > 0) {
    return null;
  }

  const college = ALLOWED_COLLEGES.find(
    (allowedCollege) => allowedCollege.domain === domain,
  );

  if (!college) {
    return null;
  }

  return {
    email: normalizedEmail,
    collegeName: college.collegeName,
    optionAliases: college.optionAliases,
  };
}
