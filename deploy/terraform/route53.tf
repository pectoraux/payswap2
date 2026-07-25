# =============================================================================
# PaySwap — Route 53 DNS records
# =============================================================================
# Provisions the Route 53 hosted zone (if it doesn't exist) + the A
# records (aliases) for the API, dashboard, and assets subdomains.
# All point at the CloudFront distribution.
# =============================================================================

# Hosted zone for the root domain.
resource "aws_route53_zone" "main" {
  name    = var.domain
  comment = "Hosted zone for ${var.domain}"

  tags = local.common_tags
}

# A record (alias) — api.payswap.io → CloudFront.
resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.main.zone_id
  name    = local.api_fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}

# A record (alias) — dashboard.payswap.io → CloudFront.
resource "aws_route53_record" "dashboard" {
  zone_id = aws_route53_zone.main.zone_id
  name    = local.dashboard_fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}

# A record (alias) — assets.payswap.io → CloudFront.
resource "aws_route53_record" "assets" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "assets.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}

# ACM certificate validation records (DNS).
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  zone_id         = aws_route53_zone.main.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
}

# MX record — email (SES, for transactional emails).
# Uncomment + configure when SES is provisioned.
# resource "aws_route53_record" "mx" {
#   zone_id = aws_route53_zone.main.zone_id
#   name    = var.domain
#   type    = "MX"
#   records = ["10 inbound-smtp.${var.aws_region}.amazonaws.com"]
#   ttl     = 300
# }
