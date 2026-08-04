export async function POST(request: Request): Promise<Response> {
  return Response.redirect(new URL('/', request.url));
}
