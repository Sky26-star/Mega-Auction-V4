// src/test/auth/auth.test.ts
// Phase 3 Authentication & Validation Test Suite

import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  signupSchema,
  profileSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '@/lib/validations/auth';

describe('Phase 3 — Auth Validation Schemas', () => {
  describe('loginSchema', () => {
    it('accepts valid email and password', () => {
      const result = loginSchema.safeParse({
        email: 'user@example.com',
        password: 'Password123!',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email format', () => {
      const result = loginSchema.safeParse({
        email: 'notanemail',
        password: 'Password123!',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.format().email?._errors[0]).toBe('Invalid email address');
      }
    });

    it('rejects empty password', () => {
      const result = loginSchema.safeParse({
        email: 'user@example.com',
        password: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('signupSchema', () => {
    it('accepts testemail@gmail.com without errors (regression test)', () => {
      const result = signupSchema.safeParse({
        email: 'testemail@gmail.com',
        username: 'test_user',
        displayName: 'Test User',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('testemail@gmail.com');
      }
    });

    it('accepts email with trailing spaces or uppercase letters and normalizes it', () => {
      const result = signupSchema.safeParse({
        email: '  TestEmail@gmail.com  ',
        username: 'test_user',
        displayName: 'Test User',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('testemail@gmail.com');
      }
    });

    it('accepts valid signup data matching all rules', () => {
      const result = signupSchema.safeParse({
        email: 'newuser@example.com',
        username: 'pro_manager',
        displayName: 'Pro Manager',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
      });
      expect(result.success).toBe(true);
    });

    it('rejects username shorter than 3 characters', () => {
      const result = signupSchema.safeParse({
        email: 'newuser@example.com',
        username: 'ab',
        displayName: 'Pro Manager',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.format().username?._errors[0]).toContain('at least 3 characters');
      }
    });

    it('rejects username with invalid special characters', () => {
      const result = signupSchema.safeParse({
        email: 'newuser@example.com',
        username: 'user@name!',
        displayName: 'Pro Manager',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
      });
      expect(result.success).toBe(false);
    });

    it('rejects password without numbers or special characters', () => {
      const result = signupSchema.safeParse({
        email: 'newuser@example.com',
        username: 'valid_user',
        displayName: 'Pro Manager',
        password: 'onlyletters',
        confirmPassword: 'onlyletters',
      });
      expect(result.success).toBe(false);
    });

    it('rejects mismatched password and confirmPassword', () => {
      const result = signupSchema.safeParse({
        email: 'newuser@example.com',
        username: 'valid_user',
        displayName: 'Pro Manager',
        password: 'SecurePassword123!',
        confirmPassword: 'DifferentPassword123!',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.format().confirmPassword?._errors[0]).toBe('Passwords do not match');
      }
    });
  });

  describe('profileSchema', () => {
    it('accepts valid display name and optional avatar URL', () => {
      const result = profileSchema.safeParse({
        displayName: 'New Display Name',
        avatarUrl: 'https://example.com/avatar.png',
      });
      expect(result.success).toBe(true);
    });

    it('accepts empty or null avatar URL', () => {
      const result = profileSchema.safeParse({
        displayName: 'New Display Name',
        avatarUrl: '',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid avatar URL string', () => {
      const result = profileSchema.safeParse({
        displayName: 'New Display Name',
        avatarUrl: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('forgotPasswordSchema & resetPasswordSchema', () => {
    it('validates forgot password email', () => {
      expect(forgotPasswordSchema.safeParse({ email: 'user@test.com' }).success).toBe(true);
      expect(forgotPasswordSchema.safeParse({ email: 'invalid' }).success).toBe(false);
    });

    it('validates reset password complexity and match', () => {
      expect(
        resetPasswordSchema.safeParse({
          password: 'NewPassword123!',
          confirmPassword: 'NewPassword123!',
        }).success
      ).toBe(true);
    });
  });
});
