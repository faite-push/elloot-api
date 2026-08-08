import { AppError } from "./errors";

export function routeParam(
  value: string | string[] | undefined,
  name = "id",
): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    throw new AppError(400, `Invalid parameter: ${name}`, "INVALID_PARAM");
  }
  return raw;
}
