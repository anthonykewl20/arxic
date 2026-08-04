export async function login(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
