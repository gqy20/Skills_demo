# Skills Demo 一键开始脚本 (Windows PowerShell)
# 用途：首次使用时快速配置环境

$ErrorActionPreference = "Stop"

# 颜色输出函数
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

# 显示标题
Write-Host ""
Write-ColorOutput "╔════════════════════════════════════════╗" "Cyan"
Write-ColorOutput "║   Skills Demo 一键开始                ║" "Cyan"
Write-ColorOutput "╚════════════════════════════════════════╝" "Cyan"
Write-Host ""

# [1/8] 配置 Claude Code LLM
Write-ColorOutput "[1/8] 配置 Claude Code LLM 提供商..." "Blue"
Write-Host ""
Write-ColorOutput "══════════════════════════════════════════" "Cyan"
Write-ColorOutput "     选择 Claude Code 使用的 LLM 服务" "Cyan"
Write-ColorOutput "══════════════════════════════════════════" "Cyan"
Write-Host ""
Write-Host "可选服务："
Write-Host "  1) 智谱 GLM (Zhipu)      - 国内访问快速，支持 Coding Plan" "Yellow"
Write-Host "  2) Minimax              - 国内访问快速，支持 Coding Plan" "Yellow"
Write-Host "  3) Anthropic Claude     - 官方服务（需要代理）" "Yellow"
Write-Host "  4) 跳过                  - 使用 Claude Code 默认配置" "Yellow"
Write-Host ""

$llmProvider = $null
$llmName = $null
$llmBaseUrl = $null
$llmModel = $null

while ($true) {
    $choice = Read-Host "请选择 [1-4]"
    switch ($choice) {
        "1" {
            $llmProvider = "zhipu"
            $llmName = "智谱 GLM"
            $llmBaseUrl = "https://open.bigmodel.cn/api/paas/v4/"
            $llmModel = "glm-4-plus"
            break
        }
        "2" {
            $llmProvider = "minimax"
            $llmName = "Minimax"
            $llmBaseUrl = "https://api.minimax.chat/v1/"
            $llmModel = "deepseek-chat"
            break
        }
        "3" {
            $llmProvider = "anthropic"
            $llmName = "Anthropic Claude"
            $llmBaseUrl = "https://api.anthropic.com"
            $llmModel = "claude-sonnet-4-5-20250929"
            break
        }
        "4" {
            $llmProvider = "skip"
            $llmName = "跳过"
            break
        }
        default {
            Write-ColorOutput "无效选择，请输入 1-4" "Yellow"
        }
    }
}

if ($llmProvider -ne "skip") {
    Write-Host ""
    Write-ColorOutput "已选择: $llmName" "Yellow"
    Write-Host "  Base URL: $llmBaseUrl"
    Write-Host "  Model: $llmModel"
    Write-Host ""
    $llmApiKey = Read-Host "请输入 API Key"

    if ($llmApiKey) {
        # 写入用户环境变量（当前用户）
        [Environment]::SetEnvironmentVariable("CLAUDE_API_KEY", $llmApiKey, "User")
        [Environment]::SetEnvironmentVariable("CLAUDE_BASE_URL", $llmBaseUrl, "User")
        [Environment]::SetEnvironmentVariable("CLAUDE_MODEL", $llmModel, "User")

        Write-Host ""
        Write-ColorOutput "✓ Claude Code LLM 配置已保存到用户环境变量" "Green"
        Write-ColorOutput "  请重启终端或 Claude Code 使配置生效" "Yellow"
    } else {
        Write-ColorOutput "⚠️  API Key 未输入，跳过配置" "Yellow"
    }
} else {
    Write-ColorOutput "✓ 跳过 Claude Code LLM 配置" "Green"
}

# [2/8] 检查 Claude Code
Write-Host ""
Write-ColorOutput "[2/8] 检查 Claude Code..." "Blue"
try {
    $claudeVersion = claude --version 2>$null
    if ($?) {
        Write-ColorOutput "✓ Claude Code 已安装: $claudeVersion" "Green"
    }
} catch {
    Write-ColorOutput "→ 正在检查 Claude Code 安装状态..." "Cyan"
    Write-ColorOutput "  请手动安装 Claude Code: https://claude.ai/install" "Yellow"
}

# [3/8] 检查 uv
Write-Host ""
Write-ColorOutput "[3/8] 检查 uv..." "Blue"
try {
    $uvVersion = uv --version 2>$null
    if ($?) {
        Write-ColorOutput "✓ uv 已安装: $uvVersion" "Green"
    } else {
        throw "uv not found"
    }
} catch {
    Write-ColorOutput "→ 正在安装 uv..." "Cyan"
    # Windows 安装命令
    irm https://astral.sh/uv/install.ps1 | iex
    Write-ColorOutput "✓ 安装完成" "Green"
}

# [4/8] 清理技能文件
Write-Host ""
Write-ColorOutput "[4/8] 清理技能文件..." "Blue"

$skillsPath = ".claude/skills"
$kSkills = Get-ChildItem -Path "$skillsPath/k*" -ErrorAction SilentlyContinue
$uSkills = Get-ChildItem -Path "$skillsPath/u_*" -ErrorAction SilentlyContinue
$pSkills = Get-ChildItem -Path "$skillsPath/p_*" -ErrorAction SilentlyContinue

if ($kSkills) {
    Remove-Item -Recurse -Force $kSkills.FullName
    Write-ColorOutput "✓ 已删除 k_* 技能" "Green"
}
if ($uSkills) {
    Remove-Item -Recurse -Force $uSkills.FullName
    Write-ColorOutput "✓ 已删除 u_* 技能" "Green"
}
if ($pSkills) {
    Remove-Item -Recurse -Force $pSkills.FullName
    Write-ColorOutput "✓ 已删除 p_* 技能" "Green"
}

if (-not ($kSkills -or $uSkills -or $pSkills)) {
    Write-ColorOutput "✓ 无需清理" "Green"
}

# [5/8] 清理旧数据
Write-Host ""
Write-ColorOutput "[5/8] 清理旧数据..." "Blue"
Remove-Item -Recurse -Force ".info", "results" -ErrorAction SilentlyContinue
Write-ColorOutput "✓ 清理完成" "Green"

# [6/8] 初始化配置
Write-Host ""
Write-ColorOutput "[6/8] 初始化配置..." "Blue"
New-Item -ItemType Directory -Force -Path ".info" | Out-Null
if (Test-Path ".templates/info.md") {
    Copy-Item ".templates/info.md" ".info/" -Force
}
$tasksJson = '{"next_id": 1, "tasks": {}, "user_skills": {}, "proven_skills": {}, "archived_u_skills": []}'
Set-Content -Path ".info/tasks.json" -Value $tasksJson
Write-ColorOutput "✓ 已创建 tasks.json 并复制 info.md" "Green"

# [7/8] 配置 PDF 处理 API Keys
Write-Host ""
Write-ColorOutput "[7/8] 配置 PDF 处理 API Keys..." "Blue"
Write-Host ""
Write-ColorOutput "══════════════════════════════════════════" "Cyan"
Write-ColorOutput "         PDF 处理功能需要配置 API Keys" "Cyan"
Write-ColorOutput "══════════════════════════════════════════" "Cyan"
Write-Host ""

$envFile = ".env"
$pdfConfigured = $false

if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -Raw
    if ($envContent -match "MINERU_API_KEY=") {
        Write-ColorOutput "检测到已存在的 PDF API 配置" "Yellow"
        $response = Read-Host "是否重新配置? [y/N]"
        if ($response -eq "y" -or $response -eq "Y") {
            # 删除旧配置
            (Get-Content $envFile) -notmatch "MINERU_API_KEY=|ANTHROPIC_AUTH_TOKEN=|ANTHROPIC_MODEL=|ANTHROPIC_BASE_URL=" | Set-Content $envFile
        } else {
            $pdfConfigured = $true
        }
    }
}

if (-not $pdfConfigured) {
    Write-Host ""
    Write-ColorOutput "[必需] MinerU API Key" "Yellow"
    Write-Host "  用于: PDF 转 Markdown"
    Write-Host "  获取: https://mineru.net/apiManage"
    Write-Host ""

    $mineruKey = $null
    while (-not $mineruKey) {
        $mineruKey = Read-Host "请输入 MinerU API Key"
        if (-not $mineruKey) {
            Write-ColorOutput "⚠️  API Key 不能为空" "Yellow"
        }
    }

    Write-Host ""
    Write-ColorOutput "[可选] Anthropic API Key" "Yellow"
    Write-Host "  用于: AI 生成论文摘要（中文）"
    Write-Host "  获取: https://console.anthropic.com/"
    Write-Host ""
    $anthropicKey = Read-Host "请输入 Anthropic API Key (直接回车跳过)"

    # 写入 .env 文件
    Add-Content $envFile ""
    Add-Content $envFile "# MinerU API (必需 - 用于 PDF 转 Markdown)"
    Add-Content $envFile "MINERU_API_KEY=`"$mineruKey`""
    Add-Content $envFile ""

    if ($anthropicKey) {
        Add-Content $envFile "# Anthropic Claude API (可选 - 用于生成摘要)"
        Add-Content $envFile "ANTHROPIC_AUTH_TOKEN=`"$anthropicKey`""
        Add-Content $envFile "ANTHROPIC_MODEL=claude-sonnet-4-5-20250929"
        Add-Content $envFile "ANTHROPIC_BASE_URL=https://api.anthropic.com"
        Add-Content $envFile ""
    }

    Add-Content $envFile "# PDF 并行处理配置"
    Add-Content $envFile "PDF_MAX_WORKERS=5"
    Add-Content $envFile "PDF_ENABLE_PARALLEL=true"

    Write-ColorOutput "✓ PDF API Keys 已保存" "Green"
}

# [8/8] 完成
Write-Host ""
Write-ColorOutput "[8/8] 配置完成！" "Blue"
Write-Host ""
Write-ColorOutput "╔════════════════════════════════════════╗" "Green"
Write-ColorOutput "║      配置完成！                       ║" "Green"
Write-ColorOutput "╚════════════════════════════════════════╝" "Green"
Write-Host ""
Write-Host "下一步："
Write-Host "  1. 上传个人信息      → 将文件拖入 info/ 目录"
Write-Host "  2. 生成用户画像      → 运行: /user-profile"
Write-Host "  3. 添加 PDF 文件     → 将 PDF 放入 01_articles/ 目录"
Write-Host "  4. 处理 PDF 文件     → 运行: /pdf_processor"
Write-Host "  5. 启动任务          → 运行: /commander start [描述]"
Write-Host ""
Write-ColorOutput "💡 提示: 每次对话开始时会自动检测 01_articles/ 中的 PDF 变化" "Cyan"
Write-Host ""
Write-ColorOutput "注意: 请重启 Claude Code 使环境变量配置生效" "Yellow"
Write-Host ""
