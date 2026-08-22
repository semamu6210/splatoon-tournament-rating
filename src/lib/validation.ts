import { ApiError } from "@/lib/http";

export function requiredString(value: unknown, field: string, maxLength = 120) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, `${field} is required.`);
  }

  const text = value.trim();
  if (text.length > maxLength) {
    throw new ApiError(400, `${field} must be ${maxLength} characters or fewer.`);
  }

  return text;
}

export function optionalDate(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, `${field} must be an ISO date string.`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `${field} must be a valid date.`);
  }

  return date;
}

export function nonNegativeDecimalString(value: unknown, field: string) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new ApiError(400, `${field} must be a number.`);
  }

  const text = String(value).trim();

  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new ApiError(400, `${field} must be zero or greater.`);
  }

  return text;
}

export function positiveDecimalString(value: unknown, field: string) {
  const text = nonNegativeDecimalString(value, field);

  if (Number(text) <= 0) {
    throw new ApiError(400, `${field} must be greater than zero.`);
  }

  return text;
}

export function integerIn(value: unknown, field: string, allowed: readonly number[]) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ApiError(400, `${field} must be an integer.`);
  }

  if (!allowed.includes(value)) {
    throw new ApiError(400, `${field} must be one of: ${allowed.join(", ")}.`);
  }

  return value;
}

export function areaXpValue(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ApiError(400, "areaXp must be an integer.");
  }

  if (value < 0 || value > 9999) {
    throw new ApiError(400, "areaXp is outside the accepted safety range.");
  }

  return value;
}

export function participantNameValue(value: unknown) {
  if (typeof value !== "string") {
    throw new ApiError(400, "participantName is required.");
  }

  const text = value.trim();
  if (text.length === 0) {
    throw new ApiError(400, "participantName is required.");
  }
  if (text.length > 20) {
    throw new ApiError(400, "participantName must be 20 characters or fewer.");
  }
  if (/[\r\n]/.test(text)) {
    throw new ApiError(400, "participantName cannot contain line breaks.");
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new ApiError(400, "participantName contains invalid characters.");
  }

  return text;
}
