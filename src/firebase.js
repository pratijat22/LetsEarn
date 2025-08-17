// Firebase client initialization for auth and Firestore (client-side)
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "lets-earn-le-9f1c2a7b5e-20cd3",
  appId: "1:661540386506:web:f7a3ec492c28f32539e633",
  storageBucket: "lets-earn-le-9f1c2a7b5e-20cd3.firebasestorage.app",
  apiKey: "AIzaSyAWFS12Gwg00f2Mj5ZUufPTXoNI4n3ZSMw",
  authDomain: "lets-earn-le-9f1c2a7b5e-20cd3.firebaseapp.com",
  messagingSenderId: "661540386506",
  measurementId: "G-QQR1NT9GCJ"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
