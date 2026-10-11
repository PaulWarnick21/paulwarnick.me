<#
.SYNOPSIS
  Turns the original photos into web-sized copies with no metadata.

.DESCRIPTION
  Reads every photo in photos/ (HEIC, JPG, PNG, TIFF or BMP; the folder is
  git-ignored so originals never leave this computer) and writes
  assets/photos/<name>-<width>.jpg at 800, 1600 and 2400 pixels wide, never
  upscaling. Portrait photos stop at 1600 wide (already taller than any screen),
  so only wide shots and panoramas get the 2400 version.

  HEIC is decoded with Windows' own HEIF decoder (the free "HEIF Image
  Extensions"), which also turns photos upright. Other formats are turned
  upright from their orientation tag.

  Every output is drawn onto a fresh canvas and re-encoded, so nothing from the
  original file carries over: no GPS location, camera details or timestamps.
  The script checks each output and stops if any metadata survived.

  It also writes content/photos.generated.json (sizes and an average colour per
  photo), which scripts/build.mjs uses to lay out the gallery.

  Then it makes the hero (the photo behind the name) straight from the original,
  so it stays sharp even when the photo is a panorama: a wide crop for landscape
  screens (assets/photos/hero-wide-*.jpg), a tall crop for phones held upright
  (assets/photos/hero-tall-*.jpg), and the link-preview image (assets/img/og.jpg).
  Which photo and where to centre each crop come from "hero" in content/photos.json.

  Uses only the imaging built into Windows, so there is nothing to install.

.EXAMPLE
  powershell -NoProfile -File scripts/process-photos.ps1
  node scripts/build.mjs

.EXAMPLE
  powershell -NoProfile -File scripts/process-photos.ps1 -HeroOnly
  Only remakes the hero crops and link preview (after changing "hero" in photos.json).

.EXAMPLE
  powershell -NoProfile -File scripts/process-photos.ps1 -HeroOnly -HeroSource IMG_7710.HEIC -HeroWideFocus 0.45 -HeroPrefix tenaya -HeroOutput draftshero-samples -NoOg
  Tries another photo as the hero without touching the live one: writes
  tenaya-wide-*.jpg and tenaya-tall-*.jpg into draftshero-samples.
#>
param(
  [string] $Source = (Join-Path (Split-Path -Parent $PSScriptRoot) 'photos'),
  [string] $Output = (Join-Path (Split-Path -Parent $PSScriptRoot) 'assets\photos'),
  [string] $Manifest = (Join-Path (Split-Path -Parent $PSScriptRoot) 'content\photos.generated.json'),
  [int[]] $Widths = @(800, 1600, 2400),
  [int] $MaxPortraitWidth = 1600,
  [int] $Quality = 80,
  [string] $Editorial = (Join-Path (Split-Path -Parent $PSScriptRoot) 'content\photos.json'),
  [string] $OgImage = (Join-Path (Split-Path -Parent $PSScriptRoot) 'assets\img\og.jpg'),
  [switch] $HeroOnly,
  # Overrides for trying other heroes (defaults come from "hero" in photos.json).
  [string] $HeroSource,
  [double] $HeroWideFocus = -1,
  [double] $HeroTallFocus = -1,
  [double] $HeroFocusY = -1,
  [string] $HeroPrefix = 'hero',
  [string] $HeroOutput,
  [switch] $NoOg
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationCore, WindowsBase

$heif = @('.heic', '.heif')
$supported = @('.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp') + $heif
$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)

function Get-Slug([string] $name) {
  $slug = ($name.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
  if (-not $slug) { $slug = 'photo' }
  return $slug
}

# HEIC -> in-memory bitmap via Windows' HEIF decoder. The pixels go through a
# lossless BMP so System.Drawing can resize them; BMP carries no metadata.
function Read-Heif([string] $path) {
  $stream = [System.IO.File]::OpenRead($path)
  try {
    $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($stream,
      [System.Windows.Media.Imaging.BitmapCreateOptions]::None,
      [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
    $frame = $decoder.Frames[0]
    $source = [System.Windows.Media.Imaging.BitmapSource] $frame
    # The decoder normally applies the phone's rotation itself (orientation 1).
    # If it ever reports something else, rotate here.
    $orientation = 1
    try { if ($frame.Metadata) { $orientation = [int] $frame.Metadata.GetQuery('System.Photo.Orientation') } } catch {}
    $angle = switch ($orientation) { 3 { 180 } 6 { 90 } 8 { 270 } default { 0 } }
    if ($angle) {
      $source = New-Object System.Windows.Media.Imaging.TransformedBitmap ($source, (New-Object System.Windows.Media.RotateTransform $angle))
    }
    $bmpEncoder = New-Object System.Windows.Media.Imaging.BmpBitmapEncoder
    $bmpEncoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($source))
    $memory = New-Object System.IO.MemoryStream
    $bmpEncoder.Save($memory)
    $memory.Position = 0
    return [System.Drawing.Image]::FromStream($memory)
  } finally { $stream.Dispose() }
}

# EXIF orientation 1-8 -> the flip/rotation that makes the photo upright.
function Set-Upright([System.Drawing.Image] $img) {
  $tag = 0x0112
  if (-not ($img.PropertyIdList -contains $tag)) { return }
  $value = $img.GetPropertyItem($tag).Value
  if ($value.Length -lt 2) { return }
  switch ([BitConverter]::ToUInt16($value, 0)) {
    2 { $img.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipX) }
    3 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
    4 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipX) }
    5 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipX) }
    6 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
    7 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipX) }
    8 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
  }
}

function New-Resized([System.Drawing.Image] $img, [int] $width) {
  $height = [int][Math]::Round($img.Height * $width / $img.Width)
  $bmp = New-Object System.Drawing.Bitmap $width, $height
  $bmp.SetResolution(72, 72)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $wrap = New-Object System.Drawing.Imaging.ImageAttributes
  $wrap.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)  # no faint halo at the edges
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $width, $height), 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel, $wrap)
  $wrap.Dispose()
  $g.Dispose()
  return $bmp
}

# A crop of the source (sx, sy, sw, sh) resampled to dw x dh.
function New-Cropped([System.Drawing.Image] $img, [int] $sx, [int] $sy, [int] $sw, [int] $sh, [int] $dw, [int] $dh) {
  $bmp = New-Object System.Drawing.Bitmap $dw, $dh
  $bmp.SetResolution(72, 72)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $wrap = New-Object System.Drawing.Imaging.ImageAttributes
  $wrap.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $dw, $dh), $sx, $sy, $sw, $sh, [System.Drawing.GraphicsUnit]::Pixel, $wrap)
  $wrap.Dispose()
  $g.Dispose()
  return $bmp
}

# Crop of the given aspect ratio at full height (or full width if the photo is
# narrower than that), centred on focusX (0 = left edge, 1 = right edge).
function Get-CropBox([System.Drawing.Image] $img, [double] $aspect, [double] $focusX, [double] $focusY = 0.5) {
  $h = $img.Height; $w = [int][Math]::Round($h * $aspect)
  if ($w -gt $img.Width) { $w = $img.Width; $h = [int][Math]::Round($w / $aspect) }
  $x = [int][Math]::Round($img.Width * $focusX - $w / 2)
  $x = [Math]::Max(0, [Math]::Min($img.Width - $w, $x))
  # focusY only matters when the crop is shorter than the photo (portrait photos).
  $y = [int][Math]::Round($img.Height * $focusY - $h / 2)
  $y = [Math]::Max(0, [Math]::Min($img.Height - $h, $y))
  return @($x, $y, $w, $h)
}

function Read-Original([System.IO.FileInfo] $file) {
  if ($heif -contains $file.Extension.ToLowerInvariant()) { return Read-Heif $file.FullName }
  $img = [System.Drawing.Image]::FromFile($file.FullName); Set-Upright $img; return $img
}

function Save-Checked([System.Drawing.Bitmap] $bmp, [string] $path) {
  try { $bmp.Save($path, $jpeg, $encoderParams) } finally { $bmp.Dispose() }
  Assert-NoMetadata $path
}

# Average colour, used as the placeholder tone while a photo loads.
function Get-Tone([System.Drawing.Image] $img) {
  $tiny = New-Resized $img 12
  $r = 0; $gr = 0; $b = 0; $n = 0
  for ($x = 0; $x -lt $tiny.Width; $x++) {
    for ($y = 0; $y -lt $tiny.Height; $y++) {
      $c = $tiny.GetPixel($x, $y); $r += $c.R; $gr += $c.G; $b += $c.B; $n++
    }
  }
  $tiny.Dispose()
  return ('#{0:x2}{1:x2}{2:x2}' -f [int]($r / $n), [int]($gr / $n), [int]($b / $n))
}

function Assert-NoMetadata([string] $path) {
  $check = [System.Drawing.Image]::FromFile($path)
  try {
    # Encoder-written basics (luminance/chrominance tables) are fine; anything
    # describing the photo itself (GPS 0x0000-0x001F and 0x8825, camera 0x010F/0x0110,
    # dates 0x0132/0x9003/0x9004, EXIF block 0x8769) is not.
    $sensitive = @($check.PropertyIdList | Where-Object { $_ -le 0x001F -or $_ -in 0x8825, 0x8769, 0x010F, 0x0110, 0x0132, 0x9003, 0x9004 })
    if ($sensitive.Count) { throw "Metadata survived in $path (tags: $($sensitive -join ', '))" }
  } finally { $check.Dispose() }
}

New-Item -ItemType Directory -Force -Path $Output | Out-Null

if (-not $HeroOnly) {
  if (-not (Test-Path $Source)) { throw "No originals folder at $Source" }
  New-Item -ItemType Directory -Force -Path $Output | Out-Null
  # Clear previous output so removed originals don't linger online.
  Get-ChildItem -Path $Output -Filter '*.jpg' -File | Remove-Item -Force

  $entries = New-Object System.Collections.ArrayList
  $skipped = New-Object System.Collections.ArrayList
  $used = @{}

  foreach ($file in Get-ChildItem -Path $Source -File | Sort-Object Name) {
    $ext = $file.Extension.ToLowerInvariant()
    if ($supported -notcontains $ext) {
      [void]$skipped.Add("$($file.Name) (unsupported format)")
      continue
    }
    $slug = Get-Slug $file.BaseName
    if ($used.ContainsKey($slug)) { $used[$slug]++; $slug = "$slug-$($used[$slug])" } else { $used[$slug] = 1 }

    try {
      if ($heif -contains $ext) { $img = Read-Heif $file.FullName }
      else { $img = [System.Drawing.Image]::FromFile($file.FullName); Set-Upright $img }
    } catch {
      [void]$skipped.Add("$($file.Name) (couldn't be decoded: $($_.Exception.Message))")
      continue
    }
    try {
      $limit = if ($img.Height -ge $img.Width) { [Math]::Min($img.Width, $MaxPortraitWidth) } else { $img.Width }
      $targets = @($Widths | Where-Object { $_ -le $limit } | Sort-Object)
      if (-not $targets.Count) { $targets = @($img.Width) }
      foreach ($w in $targets) {
        $path = Join-Path $Output "$slug-$w.jpg"
        $resized = New-Resized $img $w
        try { $resized.Save($path, $jpeg, $encoderParams) } finally { $resized.Dispose() }
        Assert-NoMetadata $path
      }
      [void]$entries.Add([ordered]@{
        file   = $slug
        source = $file.Name
        w      = $img.Width
        h      = $img.Height
        color  = (Get-Tone $img)
        widths = $targets
      })
      Write-Host ("  {0} -> {1} ({2}x{3})" -f $file.Name, $slug, $img.Width, $img.Height)
    } finally { $img.Dispose() }
  }

  $doc = [ordered]@{
    note = 'Generated by scripts/process-photos.ps1. Do not edit by hand; edit content/photos.json instead.'
    photos = $entries
  }
  $json = $doc | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($Manifest, $json + "`n", (New-Object System.Text.UTF8Encoding $false))

  Write-Host ''
  Write-Host "Processed $($entries.Count) photos. Metadata check passed on every file."
  if ($skipped.Count) {
    Write-Host 'Skipped:'
    $skipped | ForEach-Object { Write-Host "  $_" }
  }
}

# ---------- Hero and link preview ----------

$config = (Get-Content -Raw -Path $Editorial | ConvertFrom-Json).hero
$heroSourceName = if ($HeroSource) { $HeroSource } elseif ($config) { $config.source } else { $null }
if ($heroSourceName) {
  $heroFile = Get-Item (Join-Path $Source $heroSourceName)
  $heroDir = if ($HeroOutput) { $HeroOutput } else { $Output }
  New-Item -ItemType Directory -Force -Path $heroDir | Out-Null
  $img = Read-Original $heroFile
  try {
    $wideFocus = if ($HeroWideFocus -ge 0) { $HeroWideFocus } elseif ($config.wideFocus) { [double]$config.wideFocus } else { 0.5 }
    $tallFocus = if ($HeroTallFocus -ge 0) { $HeroTallFocus } elseif ($config.tallFocus) { [double]$config.tallFocus } else { $wideFocus }
    $focusY = if ($HeroFocusY -ge 0) { $HeroFocusY } elseif ($config.focusY) { [double]$config.focusY } else { 0.5 }

    $box = Get-CropBox $img 1.6 $wideFocus $focusY  # 16:10 for landscape screens
    foreach ($w in 1600, 2560) {
      if ($w -le $box[2]) { Save-Checked (New-Cropped $img $box[0] $box[1] $box[2] $box[3] $w ([int]($w / 1.6))) (Join-Path $heroDir "$HeroPrefix-wide-$w.jpg") }
    }
    $box = Get-CropBox $img 0.5625 $tallFocus $focusY  # 9:16 for phones held upright
    foreach ($w in 750, 1200) {
      if ($w -le $box[2]) { Save-Checked (New-Cropped $img $box[0] $box[1] $box[2] $box[3] $w ([int]($w / 0.5625))) (Join-Path $heroDir "$HeroPrefix-tall-$w.jpg") }
    }

    if ($NoOg) { Write-Host "Hero crops made from $($heroFile.Name) as $HeroPrefix-*.jpg in $heroDir."; return }

    # Link preview (1200 x 630) with the name over a soft shade, like the page.
    $box = Get-CropBox $img (1200 / 630) $wideFocus $focusY
    $og = New-Cropped $img $box[0] $box[1] $box[2] $box[3] 1200 630
    $g = [System.Drawing.Graphics]::FromImage($og)
    $g.SmoothingMode = 'HighQuality'; $g.TextRenderingHint = 'AntiAliasGridFit'
    $shade = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 240, 1200, 400), ([System.Drawing.Color]::FromArgb(0, 9, 15, 12)), ([System.Drawing.Color]::FromArgb(205, 9, 15, 12)), 90
    $shade.WrapMode = [System.Drawing.Drawing2D.WrapMode]::TileFlipXY
    $g.FillRectangle($shade, 0, 262, 1200, 368)
    $g.DrawString('Paul Warnick', (New-Object System.Drawing.Font 'Georgia', 64), [System.Drawing.Brushes]::White, 56, 448)
    $g.DrawString('Technical Team Lead at Ford Motor Company', (New-Object System.Drawing.Font 'Segoe UI', 24), (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(235, 255, 255, 255))), 60, 548)
    $g.Dispose()
    Save-Checked $og $OgImage
    Write-Host "Hero and link preview made from $($heroFile.Name)."
  } finally { $img.Dispose() }
}

Write-Host 'Next: node scripts/build.mjs'
