export type SearchResult = {
  id: number;
  source: string | null;
  source_id: string | null;
  title: string;
  summary: string | null;
  provider: string | null;
  s_category: string | null;
  region: string | null;
  target_age_min: number | null;
  target_age_max: number | null;
  apply_start_dt: string | null;
  apply_end_dt: string | null;
  target_group: string | null;
  target_tags: string[] | null;
  support_type: string | null;
  application_method?: string | null;
  required_documents?: string | null;
  additional_conditions?: string | null;
  detail_url: string | null;
  similarity: number;
  scrap_count?: number;
};

export type User = {
  login_id: string;
  role?: string;
};

export type SavedFilter = {
  filter_id?: number;
  filter_name?: string;
  regions: string[] | null;
  categories: string[] | null;
  target_age: number | null;
  user_type?: string | null;
  created_dt?: string;
};

export type SavedChat = {
  id: number;
  session_id?: string | null;
  title?: string | null;
  content: string;
  ann_ids: number[];
  created_dt: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  results?: SearchResult[];
  ctaLabel?: string;
  ctaAction?: "profile" | "login";
};
