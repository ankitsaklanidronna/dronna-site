$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$outputDir = Join-Path $PSScriptRoot "..\public\icons"
[System.IO.Directory]::CreateDirectory($outputDir) | Out-Null

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Icon {
  param(
    [int]$Size,
    [string]$OutputPath,
    [bool]$Maskable = $false
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
  $backgroundBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.ColorTranslator]::FromHtml("#0D1B3E"),
    [System.Drawing.ColorTranslator]::FromHtml("#1A3A6E"),
    45
  )
  $graphics.FillRectangle($backgroundBrush, $rect)

  $haloPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $haloRect = New-Object System.Drawing.RectangleF ($Size * 0.42), ($Size * -0.05), ($Size * 0.58), ($Size * 0.58)
  $haloPath.AddEllipse($haloRect)
  $haloBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($haloPath)
  $haloBrush.CenterColor = [System.Drawing.Color]::FromArgb(72, 249, 115, 22)
  $haloBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 249, 115, 22))
  $graphics.FillEllipse($haloBrush, $haloRect)

  $accentInset = if ($Maskable) { [int]($Size * 0.15) } else { [int]($Size * 0.08) }
  $accentPath = New-RoundedRectanglePath -X $accentInset -Y $accentInset -Width ($Size - ($accentInset * 2)) -Height ($Size - ($accentInset * 2)) -Radius ($Size * 0.18)
  $accentBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.ColorTranslator]::FromHtml("#E65100"),
    [System.Drawing.ColorTranslator]::FromHtml("#FBBF24"),
    65
  )
  $graphics.FillPath($accentBrush, $accentPath)

  $innerBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#0D1B3E"))
  $graphics.FillRectangle($innerBrush, ($Size * 0.24), ($Size * 0.24), ($Size * 0.18), ($Size * 0.52))
  $graphics.FillPie($innerBrush, ($Size * 0.23), ($Size * 0.24), ($Size * 0.54), ($Size * 0.52), 270, 180)

  $mountainBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#FFF8F0"))
  $mountainPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $mountainPath.AddPolygon(@(
    [System.Drawing.PointF]::new(($Size * 0.34), ($Size * 0.69)),
    [System.Drawing.PointF]::new(($Size * 0.45), ($Size * 0.47)),
    [System.Drawing.PointF]::new(($Size * 0.53), ($Size * 0.59)),
    [System.Drawing.PointF]::new(($Size * 0.62), ($Size * 0.41)),
    [System.Drawing.PointF]::new(($Size * 0.76), ($Size * 0.73))
  ))
  $graphics.FillPath($mountainBrush, $mountainPath)

  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $mountainPath.Dispose()
  $mountainBrush.Dispose()
  $innerBrush.Dispose()
  $accentPath.Dispose()
  $accentBrush.Dispose()
  $haloBrush.Dispose()
  $haloPath.Dispose()
  $backgroundBrush.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-Icon -Size 192 -OutputPath (Join-Path $outputDir "icon-192.png")
New-Icon -Size 512 -OutputPath (Join-Path $outputDir "icon-512.png")
New-Icon -Size 512 -OutputPath (Join-Path $outputDir "icon-maskable-512.png") -Maskable $true
New-Icon -Size 180 -OutputPath (Join-Path $outputDir "apple-touch-icon.png")
