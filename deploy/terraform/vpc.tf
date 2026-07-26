# =============================================================================
# PaySwap — VPC, subnets, security groups
# =============================================================================
# Provisions a dedicated VPC with public + private subnets across 3 AZs.
# EKS, RDS, and ElastiCache go in private subnets. NAT gateways allow
# private resources to egress to the internet. Security groups are
# scoped to least-privilege.
# =============================================================================

# VPC -----------------------------------------------------------------------
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-vpc"
  })
}

# Public subnets (1 per AZ) — for ALBs / NAT gateways.
resource "aws_subnet" "public" {
  count                   = 3
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.${count.index + 1}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-public-${count.index + 1}"
    Tier = "public"
    "kubernetes.io/role/elb" = "1"
  })
}

# Private subnets (1 per AZ) — for EKS, RDS, ElastiCache.
resource "aws_subnet" "private" {
  count                   = 3
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.${count.index + 10}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = false

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-private-${count.index + 1}"
    Tier = "private"
    "kubernetes.io/role/internal-elb" = "1"
  })
}

# Database subnets (1 per AZ) — for RDS (isolated from app subnets).
resource "aws_subnet" "database" {
  count                   = 3
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.${count.index + 20}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-database-${count.index + 1}"
    Tier = "database"
  })
}

# Internet gateway — for public subnets.
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-igw"
  })
}

# Elastic IPs for NAT gateways.
resource "aws_eip" "nat" {
  count  = 3
  domain = "vpc"

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-nat-eip-${count.index + 1}"
  })
}

# NAT gateways — 1 per AZ for HA.
resource "aws_nat_gateway" "main" {
  count         = 3
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-nat-${count.index + 1}"
  })

  depends_on = [aws_internet_gateway.main]
}

# Public route table — routes 0.0.0.0/0 via the IGW.
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-public-rt"
  })
}

resource "aws_route_table_association" "public" {
  count          = 3
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private route tables — 1 per AZ, each routing 0.0.0.0/0 via that AZ's NAT.
resource "aws_route_table" "private" {
  count  = 3
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway[count.index].id
  }

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-private-rt-${count.index + 1}"
  })
}

resource "aws_route_table_association" "private" {
  count          = 3
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_route_table_association" "database" {
  count          = 3
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Security groups -----------------------------------------------------------

# EKS node security group.
resource "aws_security_group" "eks_nodes" {
  name        = "${local.full_name}-eks-nodes"
  description = "Security group for EKS worker nodes"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "Cluster API to node"
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    self        = true
  }

  ingress {
    description = "Health checks from ALB"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-eks-nodes-sg"
  })
}

# ALB security group.
resource "aws_security_group" "alb" {
  name        = "${local.full_name}-alb"
  description = "Security group for the ALB (ingress)"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP (redirect to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-alb-sg"
  })
}

# RDS security group — only allow ingress from EKS nodes.
resource "aws_security_group" "rds" {
  name        = "${local.full_name}-rds"
  description = "Security group for the RDS PostgreSQL instance"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from EKS nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_nodes.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-rds-sg"
  })
}

# ElastiCache security group — only allow ingress from EKS nodes.
resource "aws_security_group" "redis" {
  name        = "${local.full_name}-redis"
  description = "Security group for the ElastiCache Redis cluster"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from EKS nodes"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_nodes.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.full_name}-redis-sg"
  })
}

# Data source — available AZs.
data "aws_availability_zones" "available" {
  state = "available"
}
