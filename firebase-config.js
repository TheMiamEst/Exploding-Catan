/* Your Firebase project's web config. Paste the block the Firebase console
   gives you straight over the one below, variable name and all — see
   README.md, "Setting up online play". Either `firebaseConfig` (what the
   console writes) or `FIREBASE_CONFIG` works.

   This is not a secret. Firebase web configs are meant to be public and every
   player's browser downloads this file anyway; what keeps strangers out is the
   database rules and the fact that nobody can guess your room code. Do not
   put anything else in here.

   Until this is filled in, the Online button explains itself and the local
   game (hot-seat, or you against the bots) works exactly as it always has. */
const firebaseConfig = {
  apiKey: "AIzaSyBBuuCbiXAVZxImw5450tRKtfogBJswryI",
  authDomain: "exploding-catan.firebaseapp.com",
  databaseURL: "https://exploding-catan-default-rtdb.firebaseio.com",
  projectId: "exploding-catan",
  storageBucket: "exploding-catan.firebasestorage.app",
  messagingSenderId: "592888559207",
  appId: "1:592888559207:web:8408de57e8003ed40406c2"
};
