// 25010 Characteristic: Maintainability

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:43888";

export const getToken = () => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("token") || localStorage.getItem("pasada_token");
  }
  return null;
};

export const clearAuthAndRedirect = () => {
  if (typeof window !== "undefined") {
    localStorage.removeItem("token");
    localStorage.removeItem("pasada_token");
    localStorage.removeItem("full_name");
    localStorage.removeItem("pasada_full_name");
    localStorage.removeItem("role");
    localStorage.removeItem("pasada_role");
    window.location.href = "/";
  }
};

// Global interceptor for 401 Unauthorized (Expired Tokens)
export const fetchWithAuth = async (endpoint: string, options: RequestInit = {}) => {
  const token = getToken();
  const headers = {
    ...options.headers,
    "Authorization": `Bearer ${token}`
  };
  
  // FIX: Force Tauri to use the absolute URL for the backend
  const isAbsolute = endpoint.startsWith('http');
  const url = isAbsolute ? endpoint : `${API_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  
  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 401) {
    clearAuthAndRedirect();
    throw new Error("Session expired. Please log in again.");
  }
  
  return response;
};

// Unified Status Computer (Ensures Dashboard, Table, and Exports match perfectly)
export const computeRecordStatus = (member: any, currentYear: number) => {
  if (member.status) return member.status; // B2: Defers to backend as authoritative
  
  if (!member.operator_name || member.operator_name.trim() === "") return "VACANT";
  
  const issueYear = member.issue_date ? new Date(member.issue_date).getFullYear() : 0;
  
  if (member.is_active === false || issueYear <= currentYear - 2) return "REVOKED";
  if (issueYear === currentYear - 1) return "FLAGGED";
  return "ACTIVE";
};