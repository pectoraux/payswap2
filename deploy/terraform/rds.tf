# =============================================================================
# PaySwap — RDS PostgreSQL
# =============================================================================
# Provisions a Multi-AZ RDS PostgreSQL instance with automated backups
# (30-day retention) + a subnet group spanning 3 AZs. The DB security
# group only accepts ingress from the EKS node security group.
# =============================================================================

# Random password for the master DB user (stored in SSM Parameter Store).
resource "random_password" "rds_master" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# SSM Parameter Store — RDS master password (encrypted with KMS).
resource "aws_ssm_parameter" "rds_master_password" {
  name        = "/${local.full_name}/rds/master-password"
  description = "Master password for the PaySwap RDS instance"
  type        = "SecureString"
  value       = random_password.rds_master.result

  tags = local.common_tags
}

# DB subnet group — spans 3 AZs.
resource "aws_db_subnet_group" "main" {
  name        = "${local.full_name}-db-subnet-group"
  description = "Subnet group for the PaySwap RDS instance"
  subnet_ids  = aws_subnet.database[*].id

  tags = local.common_tags
}

# RDS instance — Multi-AZ for HA.
resource "aws_db_instance" "main" {
  identifier                 = "${local.full_name}-postgres"
  engine                     = "postgres"
  engine_version             = "16.4"
  instance_class             = var.rds_instance_class
  allocated_storage          = var.rds_allocated_storage
  storage_type               = "gp3"
  storage_encrypted          = true

  db_name                    = var.project
  username                   = "payswap_admin"
  password                   = random_password.rds_master.result
  manage_master_user_password = false

  multi_az                   = var.rds_multi_az
  db_subnet_group_name       = aws_db_subnet_group.main.name
  vpc_security_group_ids     = [aws_security_group.rds.id]

  backup_retention_period    = var.rds_backup_retention_days
  backup_window              = "03:00-04:00"
  maintenance_window         = "sun:04:30-sun:05:30"

  deletion_protection        = var.environment == "production"
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${local.full_name}-postgres-final-snapshot"

  copy_tags_to_snapshot      = true
  auto_minor_version_upgrade = true

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-postgres"
  })
}

# Read replica in the secondary region (DR).
# Disabled by default — enable by setting `var.rds_multi_az = true` and
# adding a cross-region replica. (Commented out to keep the stack simple.)
# resource "aws_db_instance" "replica" {
#   provider                    = aws.secondary
#   identifier                  = "${local.full_name}-postgres-replica"
#   replicate_source_db         = aws_db_instance.main.arn
#   instance_class              = var.rds_instance_class
#   subnet_group_name           = aws_db_subnet_group.secondary.name
#   vpc_security_group_ids      = [aws_security_group.rds_secondary.id]
#   storage_encrypted           = true
#   backup_retention_period     = var.rds_backup_retention_days
#   tags                        = local.common_tags
# }
