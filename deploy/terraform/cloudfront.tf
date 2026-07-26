# =============================================================================
# PaySwap — CloudFront CDN + WAF
# =============================================================================
# CloudFront fronts the S3 assets bucket + the ALB (for the API). WAF
# rules block common attacks (SQLi, XSS, rate-limiting).
# =============================================================================

# CloudFront Origin Access Control — for S3 assets.
resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "${local.full_name}-assets-oac"
  description                       = "OAC for the PaySwap assets bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront distribution — assets (S3) + API (ALB).
resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.full_name} CDN"
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # US + EU only

  aliases = [
    local.api_fqdn,
    local.dashboard_fqdn,
    "assets.${var.domain}",
  ]

  # S3 assets origin.
  origin {
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id                = "s3-assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  # ALB API origin.
  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "alb-api"

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 30
    }
  }

  # Default cache behavior — API (ALB), no caching.
  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "alb-api"

    forwarded_values {
      query_string = true
      headers      = ["*"]
      cookies {
        forward = "all"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
    compress               = true

    web_acl_id = aws_wafv2_web_acl.main.arn
  }

  # Cache behavior for /static/* — S3 assets, cached aggressively.
  ordered_cache_behavior {
    path_pattern     = "/static/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "s3-assets"

    forwarded_values {
      query_string = false
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true

    web_acl_id = aws_wafv2_web_acl.main.arn
  }

  price_class = "PriceClass_100"

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.main.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  web_acl_id = aws_wafv2_web_acl.main.arn

  tags = local.common_tags

  depends_on = [aws_acm_certificate_validation.main]
}

# WAF — block SQLi, XSS, rate-limit per IP.
resource "aws_wafv2_web_acl" "main" {
  name        = "${local.full_name}-waf"
  description = "WAF for the PaySwap CloudFront distribution"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # SQL injection rule.
  rule {
    name     = "sql-injection"
    priority = 1
    action {
      block {}
    }
    statement {
      sqli_match_statement {
        field_to_match {
          all_query_arguments {}
        }
        text_transformation {
          priority = 0
          type     = "URL_DECODE"
        }
        text_transformation {
          priority = 1
          type     = "LOWERCASE"
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "sql-injection"
      sampled_requests_enabled   = true
    }
  }

  # XSS rule.
  rule {
    name     = "xss"
    priority = 2
    action {
      block {}
    }
    statement {
      xss_match_statement {
        field_to_match {
          all_query_arguments {}
        }
        text_transformation {
          priority = 0
          type     = "URL_DECODE"
        }
        text_transformation {
          priority = 1
          type     = "HTML_ENTITY_DECODE"
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "xss"
      sampled_requests_enabled   = true
    }
  }

  # Rate-limit per IP — 1000 req / 5 min.
  rule {
    name     = "rate-limit-per-ip"
    priority = 3
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 1000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-per-ip"
      sampled_requests_enabled   = true
    }
  }

  # AWS managed common rule set.
  rule {
    name     = "aws-managed-common"
    priority = 4
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-managed-common"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.full_name}-waf"
    sampled_requests_enabled   = true
  }

  tags = local.common_tags
}

# ACM certificate for CloudFront (must be in us-east-1).
resource "aws_acm_certificate" "main" {
  provider          = aws.us_east_1
  domain_name       = local.api_fqdn
  subject_alternative_names = [
    local.dashboard_fqdn,
    "assets.${var.domain}",
  ]
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.common_tags
}

resource "aws_acm_certificate_validation" "main" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# us-east-1 provider alias for ACM (CloudFront requires certs in us-east-1).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
