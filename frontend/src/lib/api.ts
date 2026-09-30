// 25010 Characteristic: Maintainability
// DEFINITIVE FIX: Hardcoded to bypass any Next.js .env.local poisoning during SSG build.
export const API_URL = "http://127.0.0.1:43888";

export const getToken = () => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("token") || localStorage.getItem("pasada_token");
  }
  return null;
}

export const clearAuthAndRedirect = () => {
  if (typeof window !== "undefined") {
    localStorage.removeItem("token");
    localStorage.removeItem("pasada_token");
    localStorage.removeItem("full_name");
    localStorage.removeItem("pasada_full_name");
    localStorage.removeItem("role");
    localStorage.removeItem("pasada_role");
    sessionStorage.removeItem("pasada_pin_unlocked");
    window.location.href = "/";
  }
}

// Global interceptor for 401 Unauthorized (Expired Tokens)
export const fetchWithAuth = async (endpoint: string, options: RequestInit = {}) => {
  const token = getToken();
  const headers = {
    ...options.headers,
    "Authorization": `Bearer ${token}`,
    "Pragma": "no-cache",
    "Cache-Control": "no-cache, no-store, must-revalidate"
  };

  const isAbsolute = endpoint.startsWith('http');
  const baseUrl = isAbsolute ? endpoint : `${API_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  // DEFINITIVE FIX: Append a cache-busting timestamp to absolutely destroy Next.js aggressive caching.
  const urlObj = new URL(baseUrl);
  urlObj.searchParams.append('_t', Date.now().toString());

  const response = await fetch(urlObj.toString(), {
       ...options,
       headers,
      cache: "no-store"
   });

  if (response.status === 401) {
    clearAuthAndRedirect();
    throw new Error("Session expired. Please log in again.");
  }

  return response;
}

// Unified Status Computer (Ensures Dashboard, Table, and Exports match perfectly)
export const computeRecordStatus = (member: any, currentYear: number) => {
  if (member.status) return member.status; // B2: Defers to backend as authoritative
  if (!member.operator_name || member.operator_name.trim() === "") return "VACANT";
  const issueYear = member.issue_date ? new Date(member.issue_date).getFullYear() : 0;
  if (member.is_active === false || issueYear <= currentYear - 2) return "REVOKED";
  if (issueYear === currentYear - 1) return "FLAGGED";

  return "ACTIVE";
};

// Auto-date toggle (Change Motor): default OFF. A stored value is an explicit
// user choice made in Settings; only the no-value case (fresh install, or an
// install that never touched the toggle) resolves to OFF.
export const resolveAutoChangeMotorDate = (stored: string | null): boolean =>
  stored === "true";

// Friendly text for a failed login/register call. The backend detail line is
// shown when it exists (lockouts, closed registration), and a network failure
// gets a hint that names the two real causes seen in the office: the backend
// on this PC is not running, or the clock is wrong.
export const describeAuthError = (err: unknown, fallback: string): string => {
  if (err instanceof TypeError) {
    return "Cannot reach the PASADA server on this computer. Make sure PASADA is open here, and check that this PC's date and time are correct.";
  }
  return fallback;
};
