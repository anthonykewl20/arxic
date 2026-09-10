export type StoredUser = {
  email: string;
  passwordHash: string;
  passwordSalt: string;
};

const users = new Map<string, StoredUser>();

export function findUserByEmail(email: string): StoredUser | undefined {
  return users.get(email.trim().toLowerCase());
}

export function createUser(user: StoredUser): StoredUser {
  const key = user.email.trim().toLowerCase();
  users.set(key, user);
  return user;
}
