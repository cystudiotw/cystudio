<?php
/**
 * Plugin Name: CY Studio — 發文自動重建前端
 * Description: WordPress 發佈／更新／刪除文章或作品後，排程 1 小時後觸發 GitHub Actions 重新建置 cystudio.tw；並在「工具 → 重建前端網站」提供手動立即重建按鈕。
 * Version: 1.1.0
 * Author: 雲橙工作室
 *
 * 安裝方式：
 *   1. 把這個檔案放到 wp-content/mu-plugins/cystudio-rebuild.php
 *      （mu-plugins 資料夾不存在就自己建立）
 *   2. 在 wp-config.php 加入：
 *        define('CYSTUDIO_GITHUB_TOKEN', 'github_pat_xxxxxxxx');
 *        define('CYSTUDIO_GITHUB_REPO', 'cystudiotw/cystudio');
 *   3. 後台「工具 → 重建前端網站」應會出現按鈕
 *
 * 詳細步驟見 docs/wordpress-rebuild.md
 */

if (!defined('ABSPATH')) {
    exit;
}

const CYSTUDIO_DISPATCH_EVENT = 'wp-update';

/**
 * 取得 GitHub 設定；沒設定就回傳 null。
 */
function cystudio_github_config() {
    $token = defined('CYSTUDIO_GITHUB_TOKEN') ? trim(CYSTUDIO_GITHUB_TOKEN) : '';
    $repo  = defined('CYSTUDIO_GITHUB_REPO') ? trim(CYSTUDIO_GITHUB_REPO) : '';
    return ($token && $repo) ? [$token, $repo] : null;
}

/**
 * 觸發 GitHub Actions 的 repository_dispatch（對應 deploy.yml 的 wp-update 事件）。
 *
 * @param string $source 觸發來源（auto / manual），只用於記錄。
 * @return true|WP_Error
 */
function cystudio_dispatch_rebuild($source = 'auto') {
    $config = cystudio_github_config();
    if (!$config) {
        return new WP_Error('cystudio_not_configured', '尚未設定 CYSTUDIO_GITHUB_TOKEN / CYSTUDIO_GITHUB_REPO');
    }

    list($token, $repo) = $config;

    $response = wp_remote_post(
        "https://api.github.com/repos/{$repo}/dispatches",
        [
            'timeout' => 15,
            'headers' => [
                'Accept'               => 'application/vnd.github+json',
                'Authorization'        => "Bearer {$token}",
                'X-GitHub-Api-Version' => '2022-11-28',
                'User-Agent'           => 'cystudio-wordpress',
            ],
            'body' => wp_json_encode([
                'event_type'     => CYSTUDIO_DISPATCH_EVENT,
                'client_payload' => [
                    'source' => $source,
                    'site'   => home_url(),
                ],
            ]),
        ]
    );

    if (is_wp_error($response)) {
        return $response;
    }

    $code = (int) wp_remote_retrieve_response_code($response);
    if ($code < 200 || $code >= 300) {
        return new WP_Error(
            'cystudio_dispatch_failed',
            "GitHub API 回應 HTTP {$code}：" . wp_remote_retrieve_body($response)
        );
    }

    update_option('cystudio_last_rebuild', [
        'time'   => time(),
        'source' => $source,
    ], false);

    return true;
}

/**
 * 重建延遲秒數（預設 1 小時）。
 * 可在 wp-config.php 覆寫，例如 30 分鐘：define('CYSTUDIO_REBUILD_DELAY', 1800);
 */
function cystudio_rebuild_delay() {
    $delay = defined('CYSTUDIO_REBUILD_DELAY') ? (int) CYSTUDIO_REBUILD_DELAY : HOUR_IN_SECONDS;
    return max(0, $delay);
}

/**
 * 排程一次重建：1 小時後執行；這期間的多次修改會合併成同一次重建。
 * 已經有排程就不重複排（避免每改一次就重建一次）。
 */
function cystudio_schedule_rebuild() {
    if (wp_next_scheduled('cystudio_rebuild_event')) {
        return;
    }

    $delay = cystudio_rebuild_delay();
    if ($delay <= 0) {
        cystudio_dispatch_rebuild('auto');
        return;
    }

    wp_schedule_single_event(time() + $delay, 'cystudio_rebuild_event');
}

/**
 * 排程時間到：實際觸發 GitHub 重建。
 */
function cystudio_run_scheduled_rebuild() {
    cystudio_dispatch_rebuild('scheduled');
}
add_action('cystudio_rebuild_event', 'cystudio_run_scheduled_rebuild');

/**
 * 發佈／更新已發佈的文章或作品時，排程 1 小時後重建。
 */
function cystudio_maybe_dispatch_on_save($post_id, $post, $update) {
    if (wp_is_post_autosave($post_id) || wp_is_post_revision($post_id)) {
        return;
    }
    if (!$post || 'publish' !== $post->post_status) {
        return;
    }

    $types = apply_filters('cystudio_rebuild_post_types', ['post', 'project']);
    if (!in_array($post->post_type, $types, true)) {
        return;
    }

    cystudio_schedule_rebuild();
}
add_action('save_post', 'cystudio_maybe_dispatch_on_save', 10, 3);

/**
 * 刪除已發佈的文章或作品時也排程重建（避免前台留著已刪除的頁面）。
 */
function cystudio_maybe_dispatch_on_delete($post_id) {
    $post = get_post($post_id);
    if (!$post || 'publish' !== $post->post_status) {
        return;
    }

    $types = apply_filters('cystudio_rebuild_post_types', ['post', 'project']);
    if (!in_array($post->post_type, $types, true)) {
        return;
    }

    cystudio_schedule_rebuild();
}
add_action('before_delete_post', 'cystudio_maybe_dispatch_on_delete');

/**
 * 手動重建：admin-post 端點（立即執行，並取消等待中的排程）。
 */
function cystudio_handle_manual_rebuild() {
    if (!current_user_can('manage_options')) {
        wp_die('權限不足');
    }
    check_admin_referer('cystudio_rebuild');

    wp_clear_scheduled_hook('cystudio_rebuild_event');
    $result = cystudio_dispatch_rebuild('manual');

    $args = is_wp_error($result)
        ? [
            'cystudio_notice' => 'error',
            'cystudio_msg'    => rawurlencode($result->get_error_message()),
        ]
        : ['cystudio_notice' => 'ok'];

    wp_safe_redirect(add_query_arg($args, admin_url('tools.php?page=cystudio-rebuild')));
    exit;
}
add_action('admin_post_cystudio_rebuild', 'cystudio_handle_manual_rebuild');

/**
 * 後台選單：「工具 → 重建前端網站」。
 */
function cystudio_register_admin_page() {
    add_management_page(
        '重建前端網站',
        '重建前端網站',
        'manage_options',
        'cystudio-rebuild',
        'cystudio_render_admin_page'
    );
}
add_action('admin_menu', 'cystudio_register_admin_page');

/**
 * 後台頁面內容。
 */
function cystudio_render_admin_page() {
    $configured = (bool) cystudio_github_config();
    $last       = get_option('cystudio_last_rebuild');
    $scheduled  = wp_next_scheduled('cystudio_rebuild_event');
    $delay      = cystudio_rebuild_delay();
    $delay_text = $delay >= HOUR_IN_SECONDS && 0 === $delay % HOUR_IN_SECONDS
        ? ($delay / HOUR_IN_SECONDS) . ' 小時'
        : round($delay / MINUTE_IN_SECONDS) . ' 分鐘';
    $notice     = isset($_GET['cystudio_notice']) ? sanitize_key(wp_unslash($_GET['cystudio_notice'])) : '';
    $message    = isset($_GET['cystudio_msg']) ? sanitize_text_field(rawurldecode(wp_unslash($_GET['cystudio_msg']))) : '';
    $sources    = [
        'manual'    => '手動',
        'scheduled' => '排程自動',
        'auto'      => '發文自動',
    ];
    ?>
    <div class="wrap">
        <h1>重建前端網站</h1>

        <?php if ('ok' === $notice) : ?>
            <div class="notice notice-success is-dismissible">
                <p>已送出重建請求。GitHub Actions 約 1–2 分鐘完成建置與部署，接著會自動清除 Cloudflare 快取。</p>
            </div>
        <?php elseif ('error' === $notice) : ?>
            <div class="notice notice-error is-dismissible">
                <p>重建請求失敗：<?php echo esc_html($message); ?></p>
            </div>
        <?php endif; ?>

        <?php if (!$configured) : ?>
            <div class="notice notice-warning">
                <p>尚未設定 <code>CYSTUDIO_GITHUB_TOKEN</code> 或 <code>CYSTUDIO_GITHUB_REPO</code>，自動與手動重建都不會運作。請見 <code>docs/wordpress-rebuild.md</code>。</p>
            </div>
        <?php endif; ?>

        <p>WordPress 發佈、更新或刪除文章／作品後，會排程在 <strong><?php echo esc_html($delay_text); ?></strong>後自動重建；這段期間的多次修改會合併成一次。你也可以在這裡立即重建。</p>

        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <?php wp_nonce_field('cystudio_rebuild'); ?>
            <input type="hidden" name="action" value="cystudio_rebuild" />
            <?php submit_button('立即重建前端', 'primary', 'submit', false, $configured ? [] : ['disabled' => 'disabled']); ?>
        </form>

        <?php if ($scheduled) : ?>
            <p style="margin-top:16px;color:#646970;">
                已排程自動重建：<?php echo esc_html(wp_date('Y-m-d H:i:s', $scheduled)); ?>
                （按上方按鈕可立即重建並取消排程）
            </p>
        <?php endif; ?>

        <?php if ($last && !empty($last['time'])) : ?>
            <p style="margin-top:16px;color:#646970;">
                上次觸發：<?php echo esc_html(wp_date('Y-m-d H:i:s', $last['time'])); ?>
                （<?php echo esc_html($sources[$last['source'] ?? ''] ?? '自動'); ?>）
            </p>
        <?php endif; ?>
    </div>
    <?php
}
