import type { AppRoute, UserRole } from '../types/health.ts';

export const ADMIN_BOOTSTRAP_EMAIL = 'suryakumar.garikini@gmail.com';

export function isBootstrapAdminEmail(
  email: string | null | undefined,
  emailVerified: boolean | null | undefined,
): boolean {
  return Boolean(
    emailVerified === true &&
      email &&
      email.trim().toLowerCase() === ADMIN_BOOTSTRAP_EMAIL,
  );
}

export function resolveEffectiveRole(params: {
  isAuthenticated: boolean;
  email?: string | null;
  emailVerified?: boolean | null;
  firestoreRole?: UserRole | null;
  sandboxRole: UserRole;
  sandboxRoleLocked: boolean;
}): UserRole {
  if (params.isAuthenticated) {
    if (isBootstrapAdminEmail(params.email, params.emailVerified)) {
      return 'admin';
    }
    if (params.firestoreRole === 'doctor') {
      return 'doctor';
    }
    return 'patient';
  }
  return params.sandboxRole;
}

export function canAccessRoute(role: UserRole, route: AppRoute): boolean {
  if (route === 'overview' || route === 'privacy' || route === 'terms') {
    return true;
  }
  if (route === 'admin') {
    return role === 'admin';
  }
  if (route === 'doctor' || route === 'register') {
    return role === 'doctor' || role === 'admin';
  }
  if (route === 'patient' || route === 'consent' || route === 'audit') {
    return role === 'patient' || role === 'doctor' || role === 'admin';
  }
  return false;
}

export function canAccessPatientRecord(params: {
  role: UserRole;
  assignedPatientId: string;
  targetHealthId: string;
}): boolean {
  if (params.role === 'admin' || params.role === 'doctor') {
    return true;
  }
  return params.assignedPatientId === params.targetHealthId;
}
