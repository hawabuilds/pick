import {db} from "./db";
import type {StockComment} from "@/lib/types";

interface CommentRow {
  id: string;
  ticker: string;
  body: string;
  created_at: string;
  users:
    | {
        handle: string | null;
        display_name: string | null;
        pfp_url: string | null;
      }
    | {
        handle: string | null;
        display_name: string | null;
        pfp_url: string | null;
      }[]
    | null;
}

function authorFromRow(
  users: CommentRow["users"],
): StockComment["author"] {
  const row = Array.isArray(users) ? users[0] : users;
  return {
    handle: row?.handle ?? null,
    displayName: row?.display_name ?? null,
    pfpUrl: row?.pfp_url ?? null,
  };
}

function mapRow(row: CommentRow): StockComment {
  return {
    id: row.id,
    ticker: row.ticker,
    body: row.body,
    createdAt: row.created_at,
    author: authorFromRow(row.users),
  };
}

const COMMENT_SELECT =
  "id, ticker, body, created_at, users ( handle, display_name, pfp_url )";

export async function listComments(ticker: string): Promise<StockComment[]> {
  const {data, error} = await db()
    .from("stock_comments")
    .select(COMMENT_SELECT)
    .eq("ticker", ticker.toUpperCase())
    .order("created_at", {ascending: false})
    .limit(50);

  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as CommentRow));
}

export async function createComment(
  userId: string,
  ticker: string,
  body: string,
): Promise<StockComment> {
  const normalized = ticker.toUpperCase();

  const {data, error} = await db()
    .from("stock_comments")
    .insert({
      ticker: normalized,
      user_id: userId,
      body,
    })
    .select(COMMENT_SELECT)
    .single();

  if (error) throw error;
  return mapRow(data as CommentRow);
}
