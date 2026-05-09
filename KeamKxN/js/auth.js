import { supabase } from "./supabaseClient.js";

// This lets friends type "admin" instead of the Supabase Auth email.
// The email is not the secret. The password + RLS policies are the real protection.
const USERNAME_TO_EMAIL = {
  admin: "keamkxn@proton.me"
};

export async function loginWithUsername(username, password) {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const email = USERNAME_TO_EMAIL[normalizedUsername];

  if (!email) {
    throw new Error("Invalid username or password.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    throw new Error("Invalid username or password.");
  }

  return data.user;
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error) {
    console.warn("Could not get current user:", error.message);
    return null;
  }

  return user;
}

export async function isAdmin() {
  const user = await getCurrentUser();
  if (!user) return false;

  const { data, error } = await supabase.rpc("is_admin");

  if (error) {
    console.warn("Admin check failed:", error.message);
    return false;
  }

  return Boolean(data);
}