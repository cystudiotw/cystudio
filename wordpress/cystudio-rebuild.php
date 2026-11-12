<?php
/**
 * Plugin Name: CY Studio — 發文自動重建前端
 * Description: WordPress 發佈／更新／刪除文章或作品後，自動觸發 GitHub Actions 重新建置 cystudio.tw；並在「工具 → 重建前端網站」提供手動重建按鈕。
 * Version: 1.0.0
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
 * 發佈／更新已發佈的文章或作品時自動重建（每 60 秒最多觸發一次，避免批次編輯連發）。
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
    if (get_transient('cystudio_rebuild_lock')) {
        return;
    }

    set_transient('cystudio_rebuild_lock', 1, MINUTE_IN_SECONDS);
    cystudio_dispatch_rebuild('auto');
}
add_action('save_post', 'cystudio_maybe_dispatch_on_save', 10, 3);

/**
 * 刪除已發佈的文章或作品時也重建（避免前台留著已刪除的頁面）。
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
    if (get_transient('cystudio_rebuild_lock')) {
        return;
    }

    set_transient('cystudio_rebuild_lock', 1, MINUTE_IN_SECONDS);
    cystudio_dispatch_rebuild('auto');
}
add_action('before_delete_post', 'cystudio_maybe_dispatch_on_delete');

/**
 * 手動重建：admin-post 端點。
 */
function cystudio_handle_manual_rebuild() {
    if (!current_user_can('manage_options')) {
        wp_die('權限不足');
    }
    check_admin_referer('cystudio_rebuild');

    $result = cystudio_dispatch_rebuild('manual');
    delete_transient('cystudio_rebuild_lock');

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
    $notice     = isset($_GET['cystudio_notice']) ? sanitize_key(wp_unslash($_GET['cystudio_notice'])) : '';
    $message    = isset($_GET['cystudio_msg']) ? sanitize_text_field(rawurldecode(wp_unslash($_GET['cystudio_msg']))) : '';
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

        <p>WordPress 發佈或更新文章／作品時會自動觸發重建（每 60 秒最多一次）。你也可以在這裡手動觸發。</p>

        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <?php wp_nonce_field('cystudio_rebuild'); ?>
            <input type="hidden" name="action" value="cystudio_rebuild" />
            <?php submit_button('立即重建前端', 'primary', 'submit', false, $configured ? [] : ['disabled' => 'disabled']); ?>
        </form>

        <?php if ($last && !empty($last['time'])) : ?>
            <p style="margin-top:16px;color:#646970;">
                上次觸發：<?php echo esc_html(wp_date('Y-m-d H:i:s', $last['time'])); ?>
                （<?php echo esc_html('manual' === ($last['source'] ?? '') ? '手動' : '發文自動'); ?>）
            </p>
        <?php endif; ?>
    </div>
    <?php
}
