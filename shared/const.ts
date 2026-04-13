export const COOKIE_NAME = "app_session_id";

/**
 * Score mínimo de similaridade (Dice coefficient) para aceitar um match
 * entre emissor Moody's e emissor ANBIMA.
 * Usado tanto para debêntures quanto para CRI/CRA.
 * Altere apenas aqui — todos os pontos do sistema referenciam esta constante.
 */
export const SCORE_MIN_THRESHOLD = 0.80;
/** Alias para CRI/CRA — aponta para a mesma constante unificada. */
export const CRI_CRA_SCORE_MIN_THRESHOLD = SCORE_MIN_THRESHOLD;
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
