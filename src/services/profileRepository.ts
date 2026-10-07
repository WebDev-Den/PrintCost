import type { UserProfile } from '../domain/types.ts';
import { INITIAL_USER_PROFILE } from '../domain/defaultData.ts';

export interface ProfileRepository {
  getProfile(): Promise<UserProfile>;
  updateProfile(updates: Partial<UserProfile>): Promise<UserProfile>;
}

const STORAGE_KEY_PROFILE = 'printcost_user_profile';

export class MockProfileRepository implements ProfileRepository {
  async getProfile(): Promise<UserProfile> {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILE);
    if (!raw) return INITIAL_USER_PROFILE;
    try {
      return JSON.parse(raw) as UserProfile;
    } catch {
      return INITIAL_USER_PROFILE;
    }
  }

  async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const current = await this.getProfile();
    const updated = { ...current, ...updates };
    localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(updated));
    return updated;
  }
}

export const profileRepository = new MockProfileRepository();
