export const COOKIE_NAME = "app_session_id";

/**
 * Score mínimo de similaridade (Dice coefficient) para aceitar um match
 * entre emissor Moody's e emissor ANBIMA. Altere apenas aqui — todos os
 * pontos do sistema (sync, dashboard, tabela) referenciam esta constante.
 */
export const SCORE_MIN_THRESHOLD = 0.80;
/**
 * Score mínimo para CRI/CRA — mais restritivo que debêntures porque
 * os nomes de devedores em CRI/CRA têm mais ambiguidade (cooperativas, SPEs).
 */
export const CRI_CRA_SCORE_MIN_THRESHOLD = 0.85;
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
