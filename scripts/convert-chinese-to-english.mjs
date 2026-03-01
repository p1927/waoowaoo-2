#!/usr/bin/env node
/**
 * One-off: replace common Chinese comments/strings with English in ts/tsx/js/jsx files.
 * Run from repo root: node scripts/convert-chinese-to-english.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const REPLACEMENTS = [
  ['// 🔐 统一权限验证', '// Auth check'],
  ['获取剧集的分镜数据（用于测试页面）', 'Get episode storyboard data (for test page)'],
  ['获取剧集的分镜数据', 'Get episode storyboard data'],
  ['获取剧集的发言人音色配置', 'Get episode speaker voice config'],
  ['获取剧集', 'Get episode'],
  ['解析发言人音色', 'Parse speaker voice'],
  ['解析现有 speakerVoices，合并新条目', 'Parse existing speakerVoices, merge new entries'],
  ['POST - 选择场景图片', 'POST - Select location image'],
  ['直接更新独立的 LocationImage 表', 'Update LocationImage table directly'],
  ['获取场景和所有图片', 'Get location and all images'],
  ['验证索引', 'Validate index'],
  ['POST - 选择角色形象的图片', 'POST - Select character appearance image'],
  ['直接更新独立的 CharacterAppearance 表', 'Update CharacterAppearance table directly'],
  ['解析图片URLs', 'Parse image URLs'],
  ['直接更新独立记录（无并发风险）', 'Update record directly (no concurrency risk)'],
  ['在 API route 中同步创建 panel（无图片），确保新 panel 立即存在于数据库，', 'Create panel synchronously in API (no image) so it exists in DB immediately;'],
  ['避免乐观更新与 worker 之间的状态真空期', 'avoid state gap between optimistic update and worker'],
  ['Task target 指向新创建的 panel，使 task state 监控系统正确追踪', 'Task target points to new panel for task state tracking'],
  ['POST - 确认场景选择并删除未选中的候选图片', 'POST - Confirm location selection and delete unselected candidates'],
  ['1. 验证已经选择了一张图片（有 isSelected 的图片）', '1. Verify one image is selected (isSelected)'],
  ['2. 删除其他未选中的图片（从 COS 和数据库）', '2. Delete other unselected images (COS + DB)'],
  ['获取场景及其图片', 'Get location and its images'],
  ['删除未选中的图片', 'Delete unselected images'],
  ['在事务中更新数据库', 'Update DB in transaction'],
  ['删除未选中的图片记录（排除选中的图片 ID）', 'Delete unselected image records (exclude selected ID)'],
  ['更新选中图片的索引为 0', 'Set selected image index to 0'],
  ['已确认选择，其他候选图片已删除', 'Selection confirmed, other candidates deleted'],
  ['标识符分集 API', 'Marker-based episode split API'],
  ['根据检测到的分集标记直接切割文本，不调用 AI', 'Split text by detected markers, no AI'],
  ['开始处理请求', 'Start processing request'],
  ['验证项目存在', 'Verify project exists'],
  ['执行分集标记检测', 'Run episode marker detection'],
  ['根据标记分割内容', 'Split content by markers'],
  ['标识符分集完成', 'Marker split done'],
  ['GET - 获取项目的所有剧集', 'GET - Get all episodes for project'],
  ['POST - 创建新剧集', 'POST - Create new episode'],
  ['创建剧集', 'Create episode'],
  ['更新最后编辑的剧集ID', 'Update last edited episode ID'],
  ['批量创建剧集 API', 'Batch create episodes API'],
  ['如果剧集数组为空，只更新 importStatus', 'If episodes array empty, only update importStatus'],
  ['批量创建剧集', 'Batch create episodes'],
  ['更新项目的 lastEpisodeId 和 importStatus', 'Update project lastEpisodeId and importStatus'],
  ['获取剧集及其关联数据', 'Get episode and related data'],
  ['更新 lastEpisodeId 失败', 'Update lastEpisodeId failed'],
  ['PATCH - 更新剧集信息', 'PATCH - Update episode'],
  ['DELETE - 删除剧集', 'DELETE - Delete episode'],
  ['删除剧集（关联数据会级联删除）', 'Delete episode (cascade)'],
  ['如果删除的是最后编辑的剧集，更新 lastEpisodeId', 'If deleted was last edited, update lastEpisodeId'],
  ['获取剧集的编辑器项目数据', 'Get episode editor project data'],
  ['保存或更新编辑器项目', 'Save or update editor project'],
  ['删除编辑器项目', 'Delete editor project'],
  ['解析请求体', 'Parse request body'],
  ['创建一个 Promise 来追踪归档完成状态', 'Promise to track archive completion'],
  ['更新单个 Clip 的信息', 'Update single Clip'],
  ['支持更新：characters, location, content, screenplay', 'Supports: characters, location, content, screenplay'],
  ['验证 Clip 是否存在且属于该项目（间接验证）', 'Verify Clip exists and belongs to project'],
  ['这里简化处理，直接通过 ID 更新，Prisma 会处理是否存在', 'Simplified: update by ID, Prisma handles existence'],
  ['POST - 清理未选中的图片', 'POST - Cleanup unselected images'],
  ['在用户确认资产进入下一步时调用', 'Called when user confirms assets for next step'],
  ['清理角色形象的未选中的图片', 'Cleanup unselected character appearance images'],
  ['删除图片记录', 'Delete image records'],
  ['只保留选中的图片', 'Keep only selected images'],
  ['清理场景的未选中的图片', 'Cleanup unselected location images'],
  ['重置选中图片的索引为0', 'Reset selected image index to 0'],
  ['POST - 确认选择并删除未选中的候选图片', 'POST - Confirm selection and delete unselected candidates'],
  ['1. 验证已经选择了一张图片（selectedIndex 不为 null）', '1. Verify one image selected (selectedIndex not null)'],
  ['2. 删除 imageUrls 中未选中的图片（从 COS 和数据库）', '2. Delete unselected from imageUrls (COS + DB)'],
  ['3. 将选中的图片设为唯一图片', '3. Set selected as sole image'],
  ['获取形象记录 - 使用 UUID 直接查询', 'Get appearance by UUID'],
  ['解析图片数组', 'Parse image array'],
  ['已经只有一张图片，无需操作', 'Already single image, no-op'],
  ['删除未选中的图片', 'Delete unselected images'],
  ['同样处理 descriptions，只保留选中的描述', 'Same for descriptions, keep only selected'],
  ['更新数据库：只保留选中的图片', 'Update DB: keep only selected images'],
  ['只保留选中的图片', 'Keep only selected'],
  ['POST - 为现有角色添加子形象', 'POST - Add sub-appearance to character'],
  ['验证角色存在', 'Verify character exists'],
  ['验证角色属于当前项目', 'Verify character belongs to project'],
  ['计算新的 appearanceIndex', 'Compute new appearanceIndex'],
  ['创建子形象', 'Create sub-appearance'],
  ['PATCH - 更新角色形象描述', 'PATCH - Update appearance description'],
  ['验证形象存在', 'Verify appearance exists'],
  ['更新描述', 'Update description'],
  ['更新 descriptions 数组', 'Update descriptions array'],
  ['如果指定了 descriptionIndex，更新对应位置；否则更新/添加第一个', 'If descriptionIndex set, update that slot; else update/add first'],
  ['DELETE - 删除单个角色形象', 'DELETE - Delete single appearance'],
  ['获取形象记录', 'Get appearance record'],
  ['删除 COS 中的图片', 'Delete images from COS'],
  ['删除主图片', 'Delete main image'],
  ['删除图片数组中的所有图片', 'Delete all images in array'],
  ['删除数据库记录', 'Delete DB record'],
  ['重新排序剩余形象的 appearanceIndex', 'Reorder remaining appearanceIndex'],
  ['更新角色的配音音色设置', 'Update character voice settings'],
  ['更新角色音色设置', 'Update character voice settings'],
  ['验证文件类型', 'Validate file type'],
  ['更新角色音色设置为自定义', 'Set character voice to custom'],
  ['GET - 获取项目资产（角色 + 场景）', 'GET - Get project assets (characters + locations)'],
  ['获取项目的角色和场景数据', 'Get project characters and locations'],
  ['验证输入', 'Validate input'],
  ['创建用户（事务）', 'Create user (transaction)'],
  ['创建用户', 'Create user'],
  ['创建用户余额记录（初始余额为0）', 'Create user balance record (initial 0)'],
  ['验证 folderId（如果提供）', 'Validate folderId if provided'],
  ['创建音色记录', 'Create voice record'],
  ['删除音色', 'Delete voice'],
  ['更新音色', 'Update voice'],
  ['更新资产中心图片上的黑边标识符（修改名字后调用）', 'Update asset hub image border label (after name change)'],
  ['更新图片的黑边标签', 'Update image border label'],
  ['更新选中状态', 'Update selected state'],
  ['更新场景', 'Update location'],
  ['删除场景', 'Delete location'],
  ['创建文件夹', 'Create folder'],
  ['更新文件夹', 'Update folder'],
  ['验证所有权', 'Verify ownership'],
  ['删除前，将文件夹内的资产移动到根目录（folderId = null）', 'Before delete, move folder assets to root (folderId = null)'],
  ['删除文件夹', 'Delete folder'],
  ['更新角色', 'Update character'],
  ['删除角色', 'Delete character'],
  ['更新形象描述', 'Update appearance description'],
  ['删除形象', 'Delete appearance'],
  ['验证角色属于用户', 'Verify character belongs to user'],
  ['更新子形象描述', 'Update sub-appearance description'],
  ['删除子形象', 'Delete sub-appearance'],
  ['更新角色信息（名字或介绍）', 'Update character (name or intro)'],
  ['构建更新数据', 'Build update payload'],
  ['更新角色', 'Update character'],
  ['删除角色（级联删除关联的形象记录）', 'Delete character (cascade appearances)'],
  ['删除角色（CharacterAppearance 会级联删除）', 'Delete character (CharacterAppearance cascade)'],
  ['创建角色', 'Create character'],
  ['创建初始形象（独立表）', 'Create initial appearance (separate table)'],
  ['普通创建：触发后台图片生成', 'Normal create: trigger background image generation'],
  ['如果设置了 artStyle，需要更新到 novelPromotionProject 中（供 generate-image 使用）', 'If artStyle set, update novelPromotionProject for generate-image'],
  ['删除场景（级联删除关联的图片记录）', 'Delete location (cascade images)'],
  ['删除场景（LocationImage 会级联删除）', 'Delete location (LocationImage cascade)'],
  ['如果传入了 artStyle，更新项目的 artStylePrompt', 'If artStyle provided, update project artStylePrompt'],
  ['创建场景', 'Create location'],
  ['创建初始图片记录', 'Create initial image record'],
  ['更新场景（名字或图片描述）', 'Update location (name or image description)'],
  ['如果提供了 name 或 summary，更新场景信息', 'If name or summary provided, update location'],
  ['如果提供了 description 和 imageIndex，更新图片描述', 'If description and imageIndex provided, update image description'],
  ['清除指定 storyboard 的 lastError', 'Clear storyboard lastError'],
  ['专门用于后台触发角色图片生成的简化 API', 'Simplified API to trigger character image generation'],
  ['如果没有传 appearanceId，获取第一个 appearance 的 id', 'If no appearanceId, get first appearance id'],
  ['将风格转换为提示词', 'Map style to prompt'],
  ['调用 generate-image API', 'Call generate-image API'],
  ['使用真正的 UUID', 'Use actual UUID'],
  ['失败', 'failed'],
  ['AI 分集 API（任务化）', 'AI episode split API (task-based)'],
  ['生成 clips（第二步：片段切分）', 'Generate clips (step 2: clip split)'],
  ['获取配音台词', 'Get voice lines'],
  ['如果没有指定 episodeId，获取该项目所有剧集的配音', 'If no episodeId, get all episode voices for project'],
  ['按台词序号排序（绝对顺序）', 'Sort by line index (absolute order)'],
  ['清理发言人名称中的非法字符', 'Sanitize speaker name'],
  ['截取台词内容前15字作为文件名的一部分', 'First 15 chars of line as filename part'],
  ['确定文件扩展名', 'Determine file extension'],
  ['文件名格式: 序号_名字_语音内容.mp3（按绝对顺序排列，不按发言人分文件夹）', 'Filename: index_name_content.mp3 (absolute order)'],
  ['key: panelKey, value: true=口型同步, false=原始', 'key: panelKey, value: true=lip-sync, false=original'],
  ['根据是否指定 episodeId 来获取数据', 'Get data by episodeId or all'],
  ['只获取指定剧集的数据', 'Get specified episode only'],
  ['获取所有剧集的数据', 'Get all episodes'],
  ['收集所有有视频的 panel', 'Collect panels with video'],
  ['使用 clip 在数组中的索引', 'Use clip index in array'],
  ['是否为口型同步视频', 'Whether lip-sync video'],
  ['从 episodes 中获取所有 storyboards 和 clips', 'Get storyboards and clips from episodes'],
  ['使用 clip 在 clips 数组中的索引来排序（兼容 Agent 模式）', 'Sort by clip index in clips array'],
  ['使用独立的 Panel 记录', 'Use standalone Panel record'],
  ['构建 panelKey 用于查找偏好', 'Build panelKey for preference lookup'],
  ['获取该 panel 的偏好，默认 true（口型同步优先）', 'Get panel preference, default true (lip-sync)'],
  ['根据用户偏好选择视频类型', 'Pick video type by user preference'],
  ['优先口型同步视频，其次原始视频', 'Prefer lip-sync then original'],
  ['优先原始视频，其次口型同步视频（如果只有口型同步视频也下载）', 'Prefer original then lip-sync (fallback lip-sync if only that)'],
  ['镜头', 'Shot'],
  ['找不到时排最后', 'When not found put last'],
  ['按 clipIndex 和 panelIndex 排序', 'Sort by clipIndex and panelIndex'],
  ['重新分配连续的全局索引', 'Reassign consecutive global index'],
  ['处理视频并打包', 'Process video and pack'],
  ['文件名使用描述，清理非法字符', 'Filename from description, sanitize'],
  ['完成归档', 'Archive complete'],
  ['等待归档完成', 'Wait for archive'],
  ['合并所有数据块', 'Merge all chunks'],
  ['只获取指定剧集的数据', 'Get specified episode only'],
  ['获取所有剧集的数据', 'Get all episodes'],
  ['收集所有有图片的 panel', 'Collect panels with images'],
  ['使用 clip 在 clips 数组中的索引来排序', 'Sort by clip index in clips array'],
  ['按 clipIndex 和 panelIndex 排序', 'Sort by clipIndex and panelIndex'],
  ['重新分配连续的全局索引', 'Reassign consecutive global index'],
  ['外部 URL，直接下载', 'External URL, download directly'],
  ['本地存储：通过文件服务 API 获取', 'Local: fetch via file API'],
  ['COS：从 COS 下载', 'COS: download from COS'],
  ['为音频URL生成签名', 'Sign audio URL'],
  ['为指定发言人直接设置音色（写入 episode.speakerVoices JSON）', 'Set speaker voice (write episode.speakerVoices JSON)'],
  ['用于不在资产库中的角色在配音阶段内联绑定音色', 'For characters not in asset hub, bind voice inline in dubbing'],
  ['将前端传来的 audioUrl（可能是 /m/m_xxx 媒体路由）还原为原始 storageKey', 'Resolve frontend audioUrl to storageKey'],
  ['保证与资产库角色的 customVoiceUrl 格式一致，Worker 端能正确处理', 'Match asset hub customVoiceUrl format for worker'],
]

function walk(dir, exts, list = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      walk(full, exts, list)
    } else if (exts.some(ext => e.name.endsWith(ext))) {
      list.push(full)
    }
  }
  return list
}

const files = walk(root, ['.ts', '.tsx', '.js', '.jsx']).filter(
  f => !f.includes('episode-marker-detector') && !f.includes('convert-chinese-to-english')
)

let total = 0
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8')
  let changed = false
  for (const [from, to] of REPLACEMENTS) {
    if (content.includes(from)) {
      content = content.split(from).join(to)
      changed = true
    }
  }
  if (changed) {
    fs.writeFileSync(file, content)
    total++
  }
}
console.log(`Updated ${total} files`)
