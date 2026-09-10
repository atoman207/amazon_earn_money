import "server-only";
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { audit } from "@/lib/server/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AppUserRow, PublicUser, UserRole } from "@/lib/supabase/database.types";

/**
 * ログインの土台。
 *
 * パスワードは平文で保存せず、scrypt（Node 標準）で塩付きハッシュにする。
 * セッションは推測できない乱数トークンを DB に置き、Cookie は httpOnly にして
 * JavaScript から読めないようにする。外部の認証サービスは使わない。
 */

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
export const SESSION_COOKIE = "price_radar_session";
const SESSION_DAYS = 30;

/** 初期アカウント。初回アクセス時に、まだ誰も居なければ作る。 */
const SEED_USERS: Array<{ email: string; password: string; name: string; role: UserRole }> = [
  { email: "admin@gmail.com", password: "admin@gmail.com", name: "管理者", role: "admin" },
  { email: "user@gmail.com", password: "user@gmail.com", name: "担当者", role: "user" },
];

export const MIN_PASSWORD_LENGTH = 8;

/* ------------------------------------------------------------------ */
/* パスワード                                                          */
/* ------------------------------------------------------------------ */

/** `<salt(hex)>:<key(hex)>` の形で保存する */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

/** 比較は timingSafeEqual で行い、当たっている桁数が時間に出ないようにする */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(keyHex, "hex");
    const actual = await scrypt(password, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 利用者                                                              */
/* ------------------------------------------------------------------ */

/**
 * 画面へ渡してよい列だけを選び直す。
 * 「ハッシュを除く」ではなく「渡すものを挙げる」書き方にして、
 * あとで秘密の列が増えても既定では漏れないようにする。
 */
export function toPublicUser(row: AppUserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    avatar_url: row.avatar_url,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function findUserByEmail(email: string): Promise<AppUserRow | null> {
  const { data } = await supabaseAdmin()
    .from("app_users")
    .select("*")
    .ilike("email", normalizeEmail(email))
    .maybeSingle();
  return (data as AppUserRow | null) ?? null;
}

export async function findUserById(id: string): Promise<AppUserRow | null> {
  const { data } = await supabaseAdmin().from("app_users").select("*").eq("id", id).maybeSingle();
  return (data as AppUserRow | null) ?? null;
}

export async function listUsers(): Promise<PublicUser[]> {
  const { data } = await supabaseAdmin()
    .from("app_users")
    .select("*")
    .order("created_at", { ascending: true });
  return ((data as AppUserRow[] | null) ?? []).map(toPublicUser);
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  phone?: string | null;
  avatarUrl?: string | null;
  role?: UserRole;
}

export async function createUser(input: CreateUserInput): Promise<PublicUser> {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("メールアドレスの形式が正しくありません");
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`);
  }
  if (!input.name.trim()) {
    throw new Error("名前を入力してください");
  }
  if (await findUserByEmail(email)) {
    throw new Error("このメールアドレスはすでに登録されています");
  }

  const { data, error } = await supabaseAdmin()
    .from("app_users")
    .insert({
      email,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      avatar_url: input.avatarUrl || null,
      password_hash: await hashPassword(input.password),
      role: input.role ?? "user",
    } as never)
    .select()
    .single();

  if (error) throw new Error(describeError(`登録できませんでした: ${error.message}`));
  await audit("system", "user_create", email, { role: input.role ?? "user" });
  return toPublicUser(data as AppUserRow);
}

export interface UpdateUserInput {
  name?: string;
  phone?: string | null;
  avatarUrl?: string | null;
  password?: string;
}

/** 本人の情報を更新する。メールと権限は変えない。 */
export async function updateUser(userId: string, input: UpdateUserInput): Promise<PublicUser> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error("名前を入力してください");
    patch.name = input.name.trim();
  }
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
  if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl || null;
  if (input.password) {
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`);
    }
    patch.password_hash = await hashPassword(input.password);
  }

  const { data, error } = await supabaseAdmin()
    .from("app_users")
    .update(patch as never)
    .eq("id", userId)
    .select()
    .single();

  if (error) throw new Error(`更新できませんでした: ${error.message}`);
  await audit("user", "user_update", userId, { fields: Object.keys(patch) });
  return toPublicUser(data as AppUserRow);
}

export async function deleteUser(userId: string): Promise<void> {
  const { error } = await supabaseAdmin().from("app_users").delete().eq("id", userId);
  if (error) throw new Error(`削除できませんでした: ${error.message}`);
  await audit("admin", "user_delete", userId, {});
}

/* ------------------------------------------------------------------ */
/* セッション                                                          */
/* ------------------------------------------------------------------ */

async function createSession(userId: string): Promise<string> {
  const token = `${randomUUID()}${randomBytes(24).toString("hex")}`;
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  const { error } = await supabaseAdmin()
    .from("sessions")
    .insert({ token, user_id: userId, expires_at: expiresAt } as never);
  if (error) throw new Error(`ログイン状態を保存できませんでした: ${error.message}`);
  return token;
}

async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

/** メールとパスワードで入り、Cookie を張る */
export async function login(email: string, password: string): Promise<PublicUser> {
  await ensureSeedUsers();

  const user = await findUserByEmail(email);
  // 利用者が居なくても同じだけ時間をかけ、存在の有無を推測させない
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, await hashPassword("dummy"));

  if (!user || !ok) throw new Error("メールアドレスかパスワードが違います");

  await setSessionCookie(await createSession(user.id));
  await audit("user", "login", user.email, { role: user.role });
  return toPublicUser(user);
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await supabaseAdmin().from("sessions").delete().eq("token", token);
  }
  store.delete(SESSION_COOKIE);
}

/** 新規登録して、そのままログインさせる */
export async function signUp(input: CreateUserInput): Promise<PublicUser> {
  const user = await createUser({ ...input, role: "user" });
  await setSessionCookie(await createSession(user.id));
  await audit("user", "signup", user.email, {});
  return user;
}

/** いま入っている利用者。未ログインなら null。 */
export async function currentUser(): Promise<PublicUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { data } = await supabaseAdmin()
    .from("sessions")
    .select("user_id,expires_at")
    .eq("token", token)
    .maybeSingle();

  const session = data as { user_id: string; expires_at: string } | null;
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await supabaseAdmin().from("sessions").delete().eq("token", token);
    return null;
  }

  const user = await findUserById(session.user_id);
  return user ? toPublicUser(user) : null;
}

/* ------------------------------------------------------------------ */
/* 初期アカウント                                                      */
/* ------------------------------------------------------------------ */

let seedChecked = false;

/**
 * 誰も登録されていなければ、管理者と担当者の初期アカウントを作る。
 * 1人でも居れば何もしない（作り直しや上書きはしない）。
 */
export async function ensureSeedUsers(): Promise<void> {
  if (seedChecked) return;

  const { count, error } = await supabaseAdmin()
    .from("app_users")
    .select("id", { count: "exact", head: true });

  // テーブルがまだ無いときは黙って諦める（画面側が案内する）
  if (error) return;
  seedChecked = true;
  if ((count ?? 0) > 0) return;

  for (const seed of SEED_USERS) {
    await createUser(seed).catch(() => undefined);
  }
}

/** app_users がまだ無いDBで、原因の分からないエラーにしないための言い換え */
function describeError(message: string): string {
  if (/app_users|sessions|schema cache|does not exist/i.test(message)) {
    return "ログインの保存先がまだありません。supabase/migrations/0001_init.sql の全文を SQL Editor で実行してください（npm run db:verify で確認できます）。";
  }
  return message;
}
