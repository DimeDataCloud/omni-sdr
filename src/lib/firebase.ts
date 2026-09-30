// Firebase stubs to allow UI to compile while Claude builds Postgres backend

export const db = {};
export const auth = { currentUser: null };

export const initAuth = (onAuthSuccess?: any, onAuthFailure?: any) => {
  if (onAuthFailure) onAuthFailure();
  return () => {};
};

export const googleSignIn = async (): Promise<any> => {
  return null;
};

export const getAccessToken = async () => {
  return null;
};

export const setAccessToken = (token: string | null) => {};

export const logout = async () => {};

export const doc = (...args: any[]) => ({});
export const setDoc = async (...args: any[]) => {};
export const getDocFromServer = async (...args: any[]) => ({});
export const collection = (...args: any[]) => ({});
export const getDocs = async (...args: any[]) => ({});
export const updateDoc = async (...args: any[]) => {};
export const query = (...args: any[]) => ({});
export const where = (...args: any[]) => ({});
export const onSnapshot = (...args: any[]) => () => {};

export type User = any;
