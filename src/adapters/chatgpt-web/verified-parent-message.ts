// Object identity cannot be forged by serialized HTTP input. Only the native-journal
// normalizer registers messages here; reparsing preserves the raw input objects.
const verified = new WeakSet<object>();
export function markVerifiedParentMessage<T extends object>(message: T): T {
  verified.add(message);
  return message;
}
export function isVerifiedParentMessage(message: object): boolean {
  return verified.has(message);
}
