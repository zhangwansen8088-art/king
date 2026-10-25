import type { UserRole } from '@max-promotion/contracts';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}
