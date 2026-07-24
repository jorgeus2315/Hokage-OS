export function Toast({ message }: { message: string }) {
  if (!message) return null;
  return <div className="hk-toast">{message}</div>;
}
