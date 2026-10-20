import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, type User } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, type Unsubscribe } from "firebase/firestore";
import { getFirestore } from "firebase/firestore";
import type { EventRecord, UserProfile } from "../types";
import { firebaseConfigured } from "./config";

const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
};

export { firebaseConfigured };
export const firebaseApp: FirebaseApp | undefined = firebaseConfigured ? initializeApp(firebaseConfig) : undefined;
export const auth = firebaseApp ? getAuth(firebaseApp) : undefined;
export const db = firebaseApp ? getFirestore(firebaseApp) : undefined;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

if (firebaseApp && env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY) {
  if (import.meta.env.DEV && env.VITE_APPCHECK_DEBUG === "true") {
    (self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

export async function signInWithGoogle(): Promise<User> {
  if (!auth) throw new Error("Firebase sign-in is not configured yet.");
  const result = await signInWithPopup(auth, googleProvider);
  const profile: UserProfile = {
    uid: result.user.uid,
    displayName: result.user.displayName || "Gatherly member",
    email: result.user.email || "",
    photoURL: result.user.photoURL || undefined,
    createdAt: new Date().toISOString(),
  };
  const profileRef = doc(db!, "users", result.user.uid);
  const existing = await getDoc(profileRef);
  await setDoc(profileRef, {
    ...profile,
    createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return result.user;
}

export async function signOutUser(): Promise<void> {
  if (auth) await signOut(auth);
}

export function watchEvents(uid: string, callback: (events: EventRecord[]) => void, onError: (error: Error) => void): Unsubscribe {
  if (!db) throw new Error("Cloud Firestore is not configured.");
  return onSnapshot(collection(db, "users", uid, "events"), (snapshot) => {
    callback(snapshot.docs.map((item) => item.data() as EventRecord));
  }, (error) => onError(error));
}

export async function saveEvent(uid: string, event: EventRecord): Promise<void> {
  if (!db) throw new Error("Cloud Firestore is not configured.");
  await setDoc(doc(db, "users", uid, "events", event.id), {
    ...event,
    updatedAt: serverTimestamp(),
  });
}
