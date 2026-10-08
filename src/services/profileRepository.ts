import type { UserProfile } from '../domain/types.ts';
import { api } from './api.ts';

export interface ProfileRepository {
  getProfile(): Promise<UserProfile>;
  updateProfile(updates: Partial<UserProfile>): Promise<UserProfile>;
}

export class MockProfileRepository implements ProfileRepository {
  async getProfile(): Promise<UserProfile> {
    return api.profile.getProfile();
  }

  async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    return api.profile.updateProfile(updates);
  }
}

export const profileRepository = new MockProfileRepository();
