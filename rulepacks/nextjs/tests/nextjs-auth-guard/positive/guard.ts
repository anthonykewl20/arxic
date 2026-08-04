export async function login(data: FormData) {
  return verifyCsrf(data);
}
