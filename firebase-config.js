// Firebase project configuration — PLDT
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDwEhTcIAJkwLoLCUh4eqEY20KsbenmXrQ",
  authDomain: "pldtqamanagement.firebaseapp.com",
  projectId: "pldtqamanagement",
  storageBucket: "pldtqamanagement.firebasestorage.app",
  messagingSenderId: "935852786747",
  appId: "1:935852786747:web:08fd0e98362aceb805081e"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
