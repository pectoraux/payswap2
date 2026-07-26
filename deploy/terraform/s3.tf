# =============================================================================
# PaySwap — S3 buckets (backups + static assets)
# =============================================================================
# Two S3 buckets:
#   - `payswap-backups`  — DR backups (event store + ledger snapshots +
#                          full state), with versioning + lifecycle +
#                          cross-region replication.
#   - `payswap-assets`   — static assets (logos, generated PDFs, etc.),
#                          fronted by CloudFront.
# =============================================================================

# Backups bucket (primary region).
resource "aws_s3_bucket" "backups" {
  bucket = "${local.full_name}-backups"

  tags = merge(local.common_tags, {
    Name     = "${local.full_name}-backups"
    Purpose  = "dr-backups"
  })
}

# Versioning — required for backup integrity.
resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Server-side encryption with KMS.
resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

# Lifecycle — transition to Standard-IA after 30 days, Glacier after 90,
# expire after 365 days. (Old backups are pruned in-app too.)
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "backups-lifecycle"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 365
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# Block all public access.
resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Static assets bucket — fronted by CloudFront (see cloudfront.tf).
resource "aws_s3_bucket" "assets" {
  bucket = "${local.full_name}-assets"

  tags = merge(local.common_tags, {
    Name    = "${local.full_name}-assets"
    Purpose = "static-assets"
  })
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

# Bucket policy — allow CloudFront to read assets (Origin Access Control).
resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontServicePrincipalReadOnly"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.assets.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.main.arn
          }
        }
      }
    ]
  })
}

# Terraform state bucket (referenced by the backend config in main.tf).
# This is created out-of-band (you can't manage your own state bucket
# with the state it stores), but we declare it here for documentation.
# resource "aws_s3_bucket" "terraform_state" {
#   bucket = "payswap-terraform-state"
#   tags   = local.common_tags
# }
