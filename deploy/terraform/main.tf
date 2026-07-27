# =============================================================================
# PaySwap — Terraform main (provider config + module references)
# =============================================================================
# This file configures the AWS provider and the common locals. The
# actual resources live in the sibling .tf files (vpc, eks, rds, s3,
# cloudfront, route53). `outputs.tf` surfaces the key endpoints.
# =============================================================================

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Backend — S3 + DynamoDB for state locking.
  # Replace with your own bucket + table.
  backend "s3" {
    bucket         = "payswap-terraform-state"
    key            = "payswap/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "payswap-terraform-locks"
    encrypt        = true
  }
}

# Primary region provider.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.tags, {
      Environment = var.environment
      Region      = var.aws_region
    })
  }
}

# Secondary region provider (for DR / multi-region).
provider "aws" {
  alias  = "secondary"
  region = var.aws_secondary_region

  default_tags {
    tags = merge(var.tags, {
      Environment = var.environment
      Region      = var.aws_secondary_region
    })
  }
}

# Locals — derived values used across modules.
locals {
  full_name    = "${var.project}-${var.environment}"
  base_domain  = var.domain
  api_fqdn     = "${var.api_subdomain}.${var.domain}"
  dashboard_fqdn = "${var.dashboard_subdomain}.${var.domain}"

  common_tags = merge(var.tags, {
    Environment = var.environment
    Project     = var.project
    ManagedBy   = "terraform"
  })
}
