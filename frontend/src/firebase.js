import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCMlvjXMngsStiXxuw7fwec6ejvWjsJess",
  authDomain: "talktodata-ca942.firebaseapp.com",
  projectId: "talktodata-ca942",
  storageBucket: "talktodata-ca942.firebasestorage.app",
  messagingSenderId: "655862431256",
  appId: "1:655862431256:web:ea54c65b3e68ef21984d6d",
  measurementId: "G-SP1ZWQZW85"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();