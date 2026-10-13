// src/lib/types/auth.ts
// Auth & Profile TypeScript Interfaces for Mega Auction V1

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserSession {
  user: {
    id: string;
    email?: string;
  };
  profile: Profile | null;
}

export interface AuthState {
  user: UserSession['user'] | null;
  profile: Profile | null;
  isLoading: boolean;
  error: string | null;
}

export type LoginInput = {
  email: string;
  password: string;
};

export type SignupInput = {
  email: string;
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
};

export type ProfileUpdateInput = {
  displayName: string;
  avatarUrl?: string | null;
};

export type ForgotPasswordInput = {
  email: string;
};

export type ResetPasswordInput = {
  password: string;
  confirmPassword: string;
};
