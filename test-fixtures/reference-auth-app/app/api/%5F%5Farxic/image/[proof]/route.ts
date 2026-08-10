const SOURCE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAlklEQVRoge2SwQkAMBCD3H9pO0QfchBwACNBOA25gRtAXtFdiLuQG7gB5BXdhbgLuYEbQF7RXYi7kBu4AeQV3YW4C7mBG0Be0V2Iu5AbuAHkFd2FuAu5gRtAXtFdiLuQG7gB5BXdhbgLuYEbQF7RXYi7kBu4AeQV3YW4C7mBG0Be0V2Iu5AbuAHkFd2FuAu5gRtAXvGHB6nc8OJ57m0sAAAAAElFTkSuQmCC',
  'base64',
);

export function GET(): Response {
  return new Response(SOURCE_PNG, {
    headers: {
      'cache-control': 'public, max-age=3600',
      'content-type': 'image/png',
    },
  });
}
