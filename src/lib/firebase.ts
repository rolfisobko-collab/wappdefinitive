import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCZee19zEwe0knn974Ti4cjgJqLscQdIuE",
  authDomain: "chatiawapp2027.firebaseapp.com",
  projectId: "chatiawapp2027",
  storageBucket: "chatiawapp2027.firebasestorage.app",
  messagingSenderId: "810782628992",
  appId: "1:810782628992:web:d06e36650ddd429a50da65",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
